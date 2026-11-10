//! 全局低级键盘钩子：作为 Raw Input 的键盘兜底。
//!
//! 游戏全屏或独占输入时，后台 Raw Input 可能收不到键盘；WH_KEYBOARD_LL
//! 在桌面层仍能拿到物理键。Raw Input 继续保留，聚合器会合并重复的按下沿。

#![cfg(windows)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use crossbeam_channel::Sender;
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, KBDLLHOOKSTRUCT, MSG, SetWindowsHookExW,
    TranslateMessage, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

use super::keymap::Keymap;
use super::{RawEvent, Shared};

const LLKHF_EXTENDED: u32 = 0x01;

static HOOK_TX: OnceLock<Mutex<Option<Sender<RawEvent>>>> = OnceLock::new();
static KEYMAP: OnceLock<Arc<Keymap>> = OnceLock::new();
static ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn active() -> bool {
    ACTIVE.load(Ordering::Relaxed)
}

fn sender() -> &'static Mutex<Option<Sender<RawEvent>>> {
    HOOK_TX.get_or_init(|| Mutex::new(None))
}

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let msg = wparam.0 as u32;
        let data = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let down = matches!(msg, WM_KEYDOWN | WM_SYSKEYDOWN);
        let up = matches!(msg, WM_KEYUP | WM_SYSKEYUP);
        if down || up {
            let at = Instant::now();
            let extended = data.flags.0 & LLKHF_EXTENDED != 0;
            let scan = data.scanCode.min(u16::MAX as u32) as u16;
            let key_id = KEYMAP.get().and_then(|km| km.id_for(scan, extended));
            if let Ok(guard) = sender().lock()
                && let Some(tx) = guard.as_ref()
            {
                let _ = tx.try_send(RawEvent::Key {
                    key_id,
                    down,
                    at,
                    unmapped: key_id.is_none().then_some(scan),
                });
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

pub fn run(_shared: Arc<Shared>, tx: Sender<RawEvent>, keymap: Arc<Keymap>) {
    let _ = KEYMAP.set(keymap);
    if let Ok(mut slot) = sender().lock() {
        *slot = Some(tx);
    }
    let hook = match unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0) } {
        Ok(hook) => hook,
        Err(err) => {
            eprintln!("[handpulse] 键盘低级钩子安装失败，继续使用 Raw Input: {err}");
            return;
        }
    };
    ACTIVE.store(true, Ordering::Relaxed);
    let mut msg = MSG::default();
    loop {
        let ret = unsafe { GetMessageW(&mut msg, None, 0, 0) };
        if !ret.as_bool() {
            break;
        }
        unsafe {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    let _ = hook;
    ACTIVE.store(false, Ordering::Relaxed);
}
