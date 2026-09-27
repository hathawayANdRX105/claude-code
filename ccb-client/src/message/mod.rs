//! Message rendering, ported 1:1 from `src/components/messages/`.
//!
//! The TypeScript side dispatches on message type and renders each with its
//! own component (40 of them, 3974 lines). Here each ported component is a
//! function from its own view data to lines, and [`render_message`] is the
//! dispatcher that replaces `Messages.tsx`'s type switch.

use ratatui::text::Line;

use crate::render;
use crate::state::{Message, Role};
use crate::theme::{fig, Ink};

mod assistant;
mod system;
mod tool;
mod user;

pub use assistant::{
    render_assistant_thinking, render_assistant_text, render_compact_boundary,
    render_grouped_tool_use, render_plan_approval, render_task_assignment,
};
pub use system::{
    render_hook_progress, render_rate_limit, render_shutdown, render_snippet_boundary,
    render_system_api_error, render_system_text,
};
pub use tool::{render_collapsed_read, render_tool_call, render_tool_use};
pub use user::{
    render_user_bash_input, render_user_bash_output, render_user_channel, render_user_command,
    render_user_cross_session, render_user_fork, render_user_github_webhook, render_user_image,
    render_user_local_command_output, render_user_memory_input, render_user_plan,
    render_user_resource_update, render_user_teammate, render_user_text,
};

/// Render any message. This replaces the type switch in `Messages.tsx`.
pub fn render_message(m: &Message) -> Vec<Line<'static>> {
    let mut lines = match m.role {
        Role::User => user::dispatch(m),
        Role::Assistant => assistant::dispatch(m),
        Role::Thought => assistant::render_assistant_thinking(m.text.as_str()),
        Role::Plan => assistant::render_plan_body(m.text.as_str()),
        Role::Terminal => render_terminal(m.text.as_str()),
        Role::Tool => match &m.tool {
            // Tool messages keep the call so the renderer decides the layout.
            Some(call) => tool::render_tool_call(call),
            None => Vec::new(),
        },
    };
    lines.push(render::blank());
    lines
}

/// The `⎿` gutter `MessageResponse.tsx` puts before a nested response body.
/// Returns the lines indented under it, matching the two-space margin plus
/// the glyph.
pub fn response_body(body: Vec<Line<'static>>) -> Vec<Line<'static>> {
    let mut out: Vec<Line<'static>> = vec![render::line(vec![render::dim(
        fig::RESPONSE_GUTTER.to_string(),
    )])];
    let mut body = body;
    render::indent(&mut body, 1);
    out.extend(body);
    out
}
