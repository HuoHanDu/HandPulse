//! 全局低级鼠标钩子：作为 Raw Input 的按键兜底。
//!
//! 某些游戏（尤其是无边框/独占全屏）会把鼠标输入抓走或屏蔽后台 Raw Input，
//! 但 WH_MOUSE_LL 仍能在桌面层拿到按键。移动仍由 Raw Input 负责，避免重复计数。

#![cfg(windows)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use crossbeam_channel::Sender;
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, MSG, MSLLHOOKSTRUCT, SetWindowsHookExW,
    TranslateMessage, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP,
    WM_MOUSEWHEEL, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_XBUTTONDOWN, WM_XBUTTONUP,
};

use super::{MouseBtn, RawEvent, Shared};

static HOOK_TX: OnceLock<Mutex<Option<Sender<RawEvent>>>> = OnceLock::new();
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
        let data = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        let at = Instant::now();
        let button = |btn: MouseBtn, down: bool| {
            if let Ok(guard) = sender().lock()
                && let Some(tx) = guard.as_ref()
            {
                let _ = tx.try_send(RawEvent::Button { btn, down, at });
            }
        };
        match msg {
            WM_LBUTTONDOWN => button(MouseBtn::Left, true),
            WM_LBUTTONUP => button(MouseBtn::Left, false),
            WM_RBUTTONDOWN => button(MouseBtn::Right, true),
            WM_RBUTTONUP => button(MouseBtn::Right, false),
            WM_MBUTTONDOWN => button(MouseBtn::Middle, true),
            WM_MBUTTONUP => button(MouseBtn::Middle, false),
            WM_XBUTTONDOWN | WM_XBUTTONUP => {
                let x = (data.mouseData >> 16) as u16;
                let (btn, down) = match (x, msg) {
                    (1, WM_XBUTTONDOWN) => (MouseBtn::Side1, true),
                    (1, WM_XBUTTONUP) => (MouseBtn::Side1, false),
                    (2, WM_XBUTTONDOWN) => (MouseBtn::Side2, true),
                    (2, WM_XBUTTONUP) => (MouseBtn::Side2, false),
                    _ => (MouseBtn::Side1, false),
                };
                if x == 1 || x == 2 {
                    button(btn, down);
                }
            }
            WM_MOUSEWHEEL => {
                let delta = ((data.mouseData >> 16) as u16) as i16;
                if let Ok(guard) = sender().lock()
                    && let Some(tx) = guard.as_ref()
                {
                    let _ = tx.try_send(RawEvent::Wheel { delta, at });
                }
            }
            _ => {}
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

pub fn run(_shared: Arc<Shared>, tx: Sender<RawEvent>) {
    if let Ok(mut slot) = sender().lock() {
        *slot = Some(tx);
    }
    let hook = match unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(hook_proc), None, 0) } {
        Ok(hook) => hook,
        Err(err) => {
            eprintln!("[handpulse] 鼠标低级钩子安装失败，继续使用 Raw Input: {err}");
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
