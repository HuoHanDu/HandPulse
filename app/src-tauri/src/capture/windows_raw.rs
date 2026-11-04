//! Windows Raw Input：消息专用窗口 + 后台输入监听。
//!
//! 只做解析与转发：不碰磁盘、不碰 UI、不记录输入内容。
//! 失败（窗口创建 / 注册设备）写入 `Shared::error`，应用仍能启动，设置页会显示“采集不可用”。

#![cfg(windows)]

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;

use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RID_INPUT, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetCursorPos, GetMessageW, GetSystemMetrics,
    TranslateMessage, HWND_MESSAGE, MSG, SM_CXSCREEN, SM_CYSCREEN, WINDOW_EX_STYLE, WINDOW_STYLE,
    WM_INPUT,
};

use super::keymap::Keymap;
use super::{MouseBtn, RawEvent, Shared};

const RI_KEY_BREAK: u16 = 0x01;
const RI_KEY_E0: u16 = 0x02;
const RI_KEY_E1: u16 = 0x04;

const RI_MOUSE_LEFT_BUTTON_DOWN: u16 = 0x0001;
const RI_MOUSE_LEFT_BUTTON_UP: u16 = 0x0002;
const RI_MOUSE_RIGHT_BUTTON_DOWN: u16 = 0x0004;
const RI_MOUSE_RIGHT_BUTTON_UP: u16 = 0x0008;
const RI_MOUSE_MIDDLE_BUTTON_DOWN: u16 = 0x0010;
const RI_MOUSE_MIDDLE_BUTTON_UP: u16 = 0x0020;
const RI_MOUSE_BUTTON_4_DOWN: u16 = 0x0040;
const RI_MOUSE_BUTTON_4_UP: u16 = 0x0080;
const RI_MOUSE_BUTTON_5_DOWN: u16 = 0x0100;
const RI_MOUSE_BUTTON_5_UP: u16 = 0x0200;
const RI_MOUSE_WHEEL: u16 = 0x0400;

pub fn run(shared: Arc<Shared>, keymap: Arc<Keymap>, tx: crossbeam_channel::Sender<RawEvent>) {
    if let Err(err) = unsafe { run_inner(&shared, &keymap, &tx) } {
        *shared.error.lock() = Some(err);
    }
}

unsafe fn run_inner(
    shared: &Arc<Shared>,
    keymap: &Arc<Keymap>,
    tx: &crossbeam_channel::Sender<RawEvent>,
) -> Result<(), String> {
    let hwnd = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("STATIC"),
            w!("HandPulseSink"),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            None,
            None,
        )
    }
    .map_err(|e| format!("创建 Raw Input 消息窗口失败：{e}"))?;

    let devices = [
        RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x06,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: hwnd,
        },
        RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x02,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: hwnd,
        },
    ];
    unsafe {
        RegisterRawInputDevices(&devices, std::mem::size_of::<RAWINPUTDEVICE>() as u32)
            .map_err(|e| format!("RegisterRawInputDevices 失败：{e}"))?;
    }

    let mut msg = MSG::default();
    loop {
        let ret = unsafe { GetMessageW(&mut msg, None, 0, 0) };
        if !ret.as_bool() {
            break;
        }
        if msg.message == WM_INPUT {
            unsafe { read_raw_input(msg.lParam, shared, keymap, tx) };
        }
        unsafe {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    Ok(())
}

unsafe fn read_raw_input(
    lparam: LPARAM,
    shared: &Shared,
    keymap: &Keymap,
    tx: &crossbeam_channel::Sender<RawEvent>,
) {
    let mut size = 0u32;
    let header_size = std::mem::size_of::<RAWINPUTHEADER>() as u32;
    let raw_handle = HRAWINPUT(lparam.0 as *mut core::ffi::c_void);
    let res = unsafe {
        GetRawInputData(raw_handle, RID_INPUT, None, &mut size, header_size)
    };
    if res == u32::MAX || size == 0 {
        return;
    }
    let mut buf = vec![0u8; size as usize];
    let read = unsafe {
        GetRawInputData(
            raw_handle,
            RID_INPUT,
            Some(buf.as_mut_ptr() as *mut core::ffi::c_void),
            &mut size,
            header_size,
        )
    };
    if read == u32::MAX || read == 0 {
        return;
    }
    let raw = unsafe { &*(buf.as_ptr() as *const RAWINPUT) };
    let at = Instant::now();
    if raw.header.dwType == RIM_TYPEKEYBOARD.0 {
        {
            let kb = unsafe { raw.data.keyboard };
            let scan = kb.MakeCode;
            let flags = kb.Flags;
            if flags & RI_KEY_E1 != 0 {
                // Pause 的 E1 序列暂不映射，计入 unmapped
                send(tx, shared, RawEvent::Key { key_id: None, down: false, at, unmapped: Some(scan) });
                return;
            }
            let extended = flags & RI_KEY_E0 != 0;
            let down = flags & RI_KEY_BREAK == 0;
            let key_id = keymap.id_for(scan, extended);
            send(tx, shared, RawEvent::Key { key_id, down, at, unmapped: key_id.is_none().then_some(scan) });
        }
    } else if raw.header.dwType == RIM_TYPEMOUSE.0 {
        {
            let mouse = unsafe { raw.data.mouse };
            let buttons = unsafe { mouse.Anonymous.Anonymous };
            let flags = buttons.usButtonFlags;
            if flags & RI_MOUSE_WHEEL != 0 {
                let delta = buttons.usButtonData as i16;
                send(tx, shared, RawEvent::Wheel { delta, at });
            }
            for (flag, btn) in [
                (RI_MOUSE_LEFT_BUTTON_DOWN, MouseBtn::Left),
                (RI_MOUSE_RIGHT_BUTTON_DOWN, MouseBtn::Right),
                (RI_MOUSE_MIDDLE_BUTTON_DOWN, MouseBtn::Middle),
                (RI_MOUSE_BUTTON_4_DOWN, MouseBtn::Side1),
                (RI_MOUSE_BUTTON_5_DOWN, MouseBtn::Side2),
            ] {
                if flags & flag != 0 {
                    send(tx, shared, RawEvent::Button { btn, down: true, at });
                }
            }
            for (flag, btn) in [
                (RI_MOUSE_LEFT_BUTTON_UP, MouseBtn::Left),
                (RI_MOUSE_RIGHT_BUTTON_UP, MouseBtn::Right),
                (RI_MOUSE_MIDDLE_BUTTON_UP, MouseBtn::Middle),
                (RI_MOUSE_BUTTON_4_UP, MouseBtn::Side1),
                (RI_MOUSE_BUTTON_5_UP, MouseBtn::Side2),
            ] {
                if flags & flag != 0 {
                    send(tx, shared, RawEvent::Button { btn, down: false, at });
                }
            }
            if mouse.lLastX != 0 || mouse.lLastY != 0 {
                send(tx, shared, RawEvent::Move { dx: mouse.lLastX, dy: mouse.lLastY, at });
            }
        }
    }
}

fn send(tx: &crossbeam_channel::Sender<RawEvent>, shared: &Shared, ev: RawEvent) {
    use crossbeam_channel::TrySendError;
    match tx.try_send(ev) {
        Ok(()) => {}
        Err(TrySendError::Full(_)) => {
            shared.dropped.fetch_add(1, Ordering::Relaxed);
        }
        Err(TrySendError::Disconnected(_)) => {}
    }
}

/// 主屏光标归一化到 32×18 网格。只统计主屏（多显示器暂不覆盖）。
pub fn cursor_grid() -> Option<(u8, u8)> {
    unsafe {
        let mut pt = POINT::default();
        if GetCursorPos(&mut pt).is_err() {
            return None;
        }
        let w = GetSystemMetrics(SM_CXSCREEN);
        let h = GetSystemMetrics(SM_CYSCREEN);
        Some(super::aggregator::grid_coords(pt.x, pt.y, w, h))
    }
}

// 让 DefWindowProcW / WPARAM / LRESULT 的导入被使用（消息默认处理由系统 STATIC 类提供）
#[allow(dead_code)]
fn _default_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wp, lp) }
}
