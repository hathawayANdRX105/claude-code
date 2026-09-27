//! The ccb thin client: a terminal UI that renders an ACP agent's output.
//!
//! The client never runs the agent. It speaks ACP v2 to a shared daemon
//! (`daemon::AcpClient`), turns the wire events into view state
//! (`state::UiState`), and draws them (`ui::render`).
//!
//! The rendering is a port of the TypeScript REPL: `theme` carries its palette
//! and glyphs, `render` the primitives its Ink components build on, `message`
//! the ~40 per-type message components, and `toolrender` the per-tool ones.

pub mod daemon;
pub mod message;
pub mod protocol;
pub mod render;
pub mod state;
pub mod theme;
pub mod toolrender;
pub mod ui;
