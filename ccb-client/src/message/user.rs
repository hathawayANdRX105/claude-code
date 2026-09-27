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
    if text.starts_with("[fork]") {
        return render_user_fork(text);
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
/// command, dimmed under a `⎿` gutter.
pub fn render_user_local_command_output(text: &str) -> Vec<Line<'static>> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut body = render::wrap(text, Style::default().fg(Ink::Subtle.color()));
    render::indent(&mut body, 1);
    let mut out = vec![render::line(vec![render::dim(
        fig::RESPONSE_GUTTER.trim_end().to_string(),
    )])];
    out.extend(body);
    out
}

/// Ported from `UserBashInputMessage.tsx`: a command the user typed into a
/// bash block, shown as a shell prompt line.
pub fn render_user_bash_input(text: &str) -> Vec<Line<'static>> {
    vec![render::line(vec![
        render::colored("!", Ink::BashBorder),
        render::raw(" "),
        render::text(text.to_string()),
    ])]
}

/// Ported from `UserBashOutputMessage.tsx`: what that command printed.
pub fn render_user_bash_output(text: &str) -> Vec<Line<'static>> {
    let mut body = render::wrap(text, Style::default().fg(Ink::Subtle.color()));
    render::indent(&mut body, 1);
    body
}

/// Ported from `UserChannelMessage.tsx`: a message that arrived over a channel.
pub fn render_user_channel(text: &str) -> Vec<Line<'static>> {
    vec![render::line(vec![
        render::colored(fig::CHANNEL_ARROW, Ink::ProfessionalBlue),
        render::raw(" "),
        render::text(text.to_string()),
    ])]
}

/// Ported from `UserCrossSessionMessage.tsx`: context injected from another
/// session, marked with the inbound arrow.
pub fn render_user_cross_session(text: &str) -> Vec<Line<'static>> {
    let mut out = vec![render::line(vec![
        render::colored(fig::INJECTED_ARROW, Ink::Merged),
        render::raw(" "),
        render::dim("from another session"),
    ])];
    if !text.is_empty() {
        let mut body = render::wrap(text, Style::default().fg(Ink::Subtle.color()));
        render::indent(&mut body, 1);
        out.extend(body);
    }
    out
}

/// Ported from `UserForkBoilerplateMessage.tsx`: the notice shown where a
/// session was forked.
pub fn render_user_fork(text: &str) -> Vec<Line<'static>> {
    let mut out = vec![render::line(vec![
        render::colored(fig::FORK_GLYPH, Ink::Merged),
        render::raw(" "),
        render::dim("forked from another session"),
    ])];
    if !text.is_empty() {
        let mut body = render::wrap(text, Style::default().fg(Ink::Subtle.color()));
        render::indent(&mut body, 1);
        out.extend(body);
    }
    out
}

/// Ported from `UserGitHubWebhookMessage.tsx`: a webhook delivery notice.
pub fn render_user_github_webhook(text: &str) -> Vec<Line<'static>> {
    vec![render::line(vec![
        render::colored(fig::REFRESH_ARROW, Ink::ChromeYellow),
        render::raw(" "),
        render::dim(text.to_string()),
    ])]
}

/// Ported from `UserImageMessage.tsx`: an image attachment. The client has no
/// image protocol on this path, so it shows the reference the agent sent.
pub fn render_user_image(text: &str) -> Vec<Line<'static>> {
    vec![render::line(vec![
        render::colored(fig::BLOCKQUOTE_BAR, Ink::Subtle),
        render::raw(" "),
        render::dim(format!("image: {text}")),
    ])]
}

/// Ported from `UserMemoryInputMessage.tsx`: a memory the user saved.
pub fn render_user_memory_input(text: &str) -> Vec<Line<'static>> {
    let mut out = vec![render::line(vec![
        render::colored(fig::REFERENCE_MARK, Ink::Permission),
        render::raw(" "),
        render::dim("memory"),
    ])];
    if !text.is_empty() {
        let mut body = render::wrap(text, Style::default().fg(Ink::Subtle.color()));
        render::indent(&mut body, 1);
        out.extend(body);
    }
    out
}

/// Ported from `UserPlanMessage.tsx`: the user accepted or rejected a plan.
pub fn render_user_plan(text: &str) -> Vec<Line<'static>> {
    let (glyph, tone) = if text.starts_with("reject") {
        (fig::DIAMOND_FILLED, Ink::Error)
    } else {
        (fig::DIAMOND_FILLED, Ink::PlanMode)
    };
    vec![render::line(vec![
        render::bold(glyph.to_string(), tone),
        render::raw(" "),
        render::text(text.to_string()),
    ])]
}

/// Ported from `UserResourceUpdateMessage.tsx`: a refreshed resource, marked
/// with the refresh arrow.
pub fn render_user_resource_update(text: &str) -> Vec<Line<'static>> {
    let mut out = vec![render::line(vec![
        render::colored(fig::REFRESH_ARROW, Ink::Success),
        render::raw(" "),
        render::bold("resource updated", Ink::Text),
    ])];
    if !text.is_empty() {
        let mut body = render::wrap(text, Style::default().fg(Ink::Subtle.color()));
        render::indent(&mut body, 1);
        out.extend(body);
    }
    out
}

/// Ported from `UserTeammateMessage.tsx` and `teamMemCollapsed.tsx`: a message
/// from a teammate, collapsed to a header when the body is long.
pub fn render_user_teammate(text: &str) -> Vec<Line<'static>> {
    const COLLAPSE_AT: usize = 6;
    let lines: Vec<&str> = text.lines().collect();
    let mut out = vec![render::line(vec![
        render::colored(fig::black_circle(), Ink::Purple),
        render::raw(" "),
        render::bold("teammate", Ink::Purple),
    ])];
    if lines.len() > COLLAPSE_AT {
        let head = lines[..COLLAPSE_AT].join("\n");
        let mut body = render::wrap(&head, Style::default().fg(Ink::Subtle.color()));
        render::indent(&mut body, 1);
        out.extend(body);
        out.push(render::line(vec![
            render::raw(render::INDENT),
            render::dim(format!("… {} more lines", lines.len() - COLLAPSE_AT)),
        ]));
    } else {
        let mut body = render::wrap(text, Style::default().fg(Ink::Subtle.color()));
        render::indent(&mut body, 1);
        out.extend(body);
    }
    out
}

