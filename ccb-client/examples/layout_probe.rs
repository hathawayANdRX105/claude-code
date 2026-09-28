//! Renders the TUI into a TestBackend so the cell layout is visible without a
//! terminal. `cargo run --example layout_probe`.

use ccb_client::protocol::AcpEvent;
use ccb_client::state::UiState;
use ccb_client::ui;
use ratatui::{backend::TestBackend, Terminal};

fn show(label: &str, state: &UiState, w: u16, h: u16) {
    println!("=== {label} ===");
    let backend = TestBackend::new(w, h);
    let mut term = Terminal::new(backend).unwrap();
    term.draw(|f| ui::render(f, state)).unwrap();
    let buf = term.backend().buffer().clone();
    for y in 0..h {
        let mut row = String::new();
        for x in 0..w {
            row.push_str(buf[(x, y)].symbol());
        }
        println!("{y:2} |{row}|");
    }
    println!();
}

fn main() {
    let mut st = UiState {
        title: "probe".into(),
        session_id: Some("s1".into()),
        input: "draft text".into(),
        ..Default::default()
    };
    st.submit("do the thing".into());

    // Interleaved on purpose: think, tool, think again, answer.
    st.apply(AcpEvent::AgentThoughtChunk { text: "planning".into() });
    st.apply(AcpEvent::ToolCallUpdate {
        tool_call_id: "t1".into(),
        name: Some("BashTool".into()),
        title: Some("cargo test".into()),
        status: Some("completed".into()),
        kind: Some("execute".into()),
        locations: vec![],
        content_text: Some("test result: ok".into()),
        diff: None,
    });
    st.apply(AcpEvent::AgentThoughtChunk { text: "done planning".into() });
    st.apply(AcpEvent::AgentMessage { text: "All good.".into() });
    st.apply(AcpEvent::StateUpdate { state: "requires_action".into() });

    show("interleaved order", &st, 60, 22);

    st.permission = Some(ccb_client::state::PendingPermission {
        id: 1,
        title: "Run a command?".into(),
        description: Some("cargo test".into()),
        tool_name: Some("BashTool".into()),
        options: vec![
            ccb_client::protocol::PermissionOption {
                option_id: "a".into(),
                name: "Yes".into(),
                kind: "allow_once".into(),
            },
            ccb_client::protocol::PermissionOption {
                option_id: "b".into(),
                name: "No".into(),
                kind: "reject_once".into(),
            },
        ],
        selected: 0,
    });
    show("with permission pane", &st, 60, 14);
}
