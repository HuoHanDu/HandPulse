//! Xbox / XInput 手柄适配。
//!
//! 浏览器 Gamepad API 在 WebView2 里不一定拿得到手柄；XInput 是 Windows 自带、
//! 不需要浏览器焦点，轮询结果直接给前端画手柄图。

#![cfg(windows)]

use serde::Serialize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use windows::Win32::UI::Input::XboxController::{
    XINPUT_GAMEPAD_A, XINPUT_GAMEPAD_B, XINPUT_GAMEPAD_BACK, XINPUT_GAMEPAD_DPAD_DOWN,
    XINPUT_GAMEPAD_DPAD_LEFT, XINPUT_GAMEPAD_DPAD_RIGHT, XINPUT_GAMEPAD_DPAD_UP,
    XINPUT_GAMEPAD_LEFT_SHOULDER, XINPUT_GAMEPAD_LEFT_THUMB, XINPUT_GAMEPAD_RIGHT_SHOULDER,
    XINPUT_GAMEPAD_RIGHT_THUMB, XINPUT_GAMEPAD_START, XINPUT_GAMEPAD_X, XINPUT_GAMEPAD_Y,
    XINPUT_STATE, XInputGetState,
};

use super::{RawEvent, Shared};

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GamepadState {
    pub connected: bool,
    /// XInput user index 0..3
    pub index: u32,
    /// 标准 17 键：A/B/X/Y/LB/RB/LT/RT/Back/Start/LS/RS/Up/Down/Left/Right/Home
    pub buttons: Vec<bool>,
    /// 左 X、左 Y、右 X、右 Y，归一化 -1..1
    pub axes: Vec<f32>,
    /// 左扳机、右扳机，0..1
    pub triggers: Vec<f32>,
}

fn axis(v: i16) -> f32 {
    let f = v as f32 / 32767.0;
    if f.abs() < 0.08 {
        0.0
    } else {
        f.clamp(-1.0, 1.0)
    }
}

/// 返回第一个已连接手柄；没有则 connected=false。
pub fn poll() -> GamepadState {
    for index in 0..4u32 {
        let mut raw = XINPUT_STATE::default();
        let rc = unsafe { XInputGetState(index, &mut raw) };
        if rc != 0 {
            continue;
        }
        let g = raw.Gamepad;
        let mut buttons = vec![false; 17];
        buttons[0] = g.wButtons.contains(XINPUT_GAMEPAD_A);
        buttons[1] = g.wButtons.contains(XINPUT_GAMEPAD_B);
        buttons[2] = g.wButtons.contains(XINPUT_GAMEPAD_X);
        buttons[3] = g.wButtons.contains(XINPUT_GAMEPAD_Y);
        buttons[4] = g.wButtons.contains(XINPUT_GAMEPAD_LEFT_SHOULDER);
        buttons[5] = g.wButtons.contains(XINPUT_GAMEPAD_RIGHT_SHOULDER);
        buttons[6] = g.bLeftTrigger > 30;
        buttons[7] = g.bRightTrigger > 30;
        buttons[8] = g.wButtons.contains(XINPUT_GAMEPAD_BACK);
        buttons[9] = g.wButtons.contains(XINPUT_GAMEPAD_START);
        buttons[10] = g.wButtons.contains(XINPUT_GAMEPAD_LEFT_THUMB);
        buttons[11] = g.wButtons.contains(XINPUT_GAMEPAD_RIGHT_THUMB);
        buttons[12] = g.wButtons.contains(XINPUT_GAMEPAD_DPAD_UP);
        buttons[13] = g.wButtons.contains(XINPUT_GAMEPAD_DPAD_DOWN);
        buttons[14] = g.wButtons.contains(XINPUT_GAMEPAD_DPAD_LEFT);
        buttons[15] = g.wButtons.contains(XINPUT_GAMEPAD_DPAD_RIGHT);
        // XInput 不提供 Guide/Home 键状态；保留位，前端不点亮。
        buttons[16] = false;
        return GamepadState {
            connected: true,
            index,
            buttons,
            axes: vec![
                axis(g.sThumbLX),
                axis(g.sThumbLY),
                axis(g.sThumbRX),
                axis(g.sThumbRY),
            ],
            triggers: vec![
                g.bLeftTrigger as f32 / 255.0,
                g.bRightTrigger as f32 / 255.0,
            ],
        };
    }
    GamepadState::default()
}

/// 后台轮询按键沿，写入 aggregator 当前桶；不依赖窗口焦点。
pub fn run(shared: Arc<Shared>, tx: crossbeam_channel::Sender<RawEvent>) {
    let mut previous = [false; 17];
    loop {
        if shared
            .shutdown_request
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            break;
        }
        let state = poll();
        for (i, down) in state.buttons.iter().enumerate().take(17) {
            if *down && !previous[i] {
                let _ = tx.try_send(RawEvent::PadButton {
                    index: i as u8,
                    at: Instant::now(),
                });
            }
        }
        previous = std::array::from_fn(|i| state.buttons.get(i).copied().unwrap_or(false));
        std::thread::sleep(Duration::from_millis(30));
    }
}
