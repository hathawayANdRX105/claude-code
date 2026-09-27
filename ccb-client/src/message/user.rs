//! User-side message renderers.
//!
//! Ported from the `User*Message.tsx` files in `src/components/messages/`.
//! Each takes the message text and produces the shape its TSX component
//! renders; the glyphs come from `src/constants/figures.ts`.

use ratatui::style::Style;
use ratatui::text::Line;

use crate::render;
use crate::state::Message;
use crate::theme::{fig, Ink};

/// Dispatch a user message. The client has no per-type field on user
/// messages, so the text prefix picks the renderer, the same way the TSX
/// components are selected by message kind upstream.
pub fn dispatch(m: &Message) -> Vec<Line<'static>> {
    let text = m.text.as_str();
    if let Some(rest) = text.strip_prefix("/") {
        return render_user_command(rest);
    }
    if text.starts_with("[channel]") || text.starts_with("←") {
        return render_user_channel(text);
    }
    render_user_text(text)
}

/// Ported from `UserTextMessage.tsx`: the user's own words, in the theme's
/// foreground, with no decoration.
pub fn render_user_text(text: &str) -> Vec<Line<'static>> {
    if text.is_empty() {
        return Vec::new();
    }
    render::wrap(text, Style::default().fg(Ink::Text.color()))
}

/// Ported from `UserCommandMessage.tsx`: a slash command, with the command
/// name in the remember colour.
pub fn render_user_command(text: &str) -> Vec<Line<'static>> {
    vec![render::line(vec![
        render::colored("/", Ink::Subtle),
        render::bold(text.to_string(), Ink::Remember),
    ])]
}

/// Ported from `UserLocalCommandOutputMessage.tsx`: the output of a local
/// Ported from `UserBashInputMessage.tsx`: a command the user typed into a
/// Ported from `UserChannelMessage.tsx`: a message that arrived over a channel.
pub fn render_user_channel(text: &str) -> Vec<Line<'static>> {
    vec![render::line(vec![
        render::colored(fig::CHANNEL_ARROW, Ink::ProfessionalBlue),
        render::raw(" "),
        render::text(text.to_string()),
    ])]
}

