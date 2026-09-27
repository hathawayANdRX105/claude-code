//! The permission dialog, ported from `src/components/permissions/`.
//!
//! `PermissionDialog.tsx` draws a bordered box in the theme's `permission`
//! colour with `PermissionRequestTitle` above the body; the option list comes
//! from the tool-specific request component. This client has one shape for
//! every tool, which is what the ACP `requestPermission` method carries: a
//! title, an optional description, and the options to pick from.

use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Clear, Paragraph, Wrap};

use crate::render;
use crate::state::PendingPermission;
use crate::theme::Ink;

/// The prompt character the REPL uses for the input and for selected options,
/// from `PromptInputModeIndicator.tsx` and `UserCommandMessage.tsx`.
pub const PROMPT_CHAR: &str = "❯";

/// The dialog's lines, without the surrounding border.
pub fn render_permission(p: &PendingPermission) -> Vec<Line<'static>> {
    let mut out: Vec<Line<'static>> = Vec::new();

    // Title, then the subtitle line the request component shows under it.
    out.push(render::line(vec![
        render::bold(p.title.clone(), Ink::Permission),
    ]));
    if let Some(tool) = &p.tool_name {
        out.push(render::dim_line(tool.clone()));
    }
    if let Some(desc) = &p.description {
        let mut body = render::wrap(
            desc,
            Style::default().fg(Ink::Subtle.color()),
        );
        render::indent(&mut body, 1);
        out.extend(body);
    }

    out.push(render::blank());
    out.extend(render_options(p));
    out.push(render::blank());
    out.push(render::line(vec![render::dim(
        "↑↓ select · enter confirm · esc reject",
    )]));
    out
}

/// The option list: the selected row carries the `❯` prompt and bold text,
/// which is how `UserCommandMessage` and the select components mark a choice.
fn render_options(p: &PendingPermission) -> Vec<Line<'static>> {
    p.options
        .iter()
        .enumerate()
        .map(|(i, opt)| {
            let selected = i == p.selected;
            let tone = option_tone(&opt.kind, selected);
            let mut spans: Vec<Span<'static>> = vec![render::raw("  ")];
            spans.push(if selected {
                render::bold(format!("{PROMPT_CHAR} "), tone)
            } else {
                render::raw("  ")
            });
            spans.push(if selected {
                Span::styled(
                    opt.name.clone(),
                    Style::default()
                        .fg(tone.color())
                        .add_modifier(Modifier::BOLD),
                )
            } else {
                render::colored(opt.name.clone(), tone)
            });
            if !opt.kind.is_empty() {
                spans.push(render::dim(format!("  ({})", opt.kind)));
            }
            render::line(spans)
        })
        .collect()
}

/// Allow options read green, reject options red, everything else takes the
/// theme's permission colour. `PermissionDialog` colours its border
/// `permission`, and the per-tool components recolour only the destructive row.
fn option_tone(kind: &str, _selected: bool) -> Ink {
    if kind.starts_with("allow_once") {
        Ink::Permission
    } else if kind.starts_with("allow_always") || kind.starts_with("allow") {
        Ink::Success
    } else if kind.starts_with("reject") {
        Ink::Error
    } else {
        Ink::Permission
    }
}

/// Draw the dialog centred over the transcript, with the permission-coloured
/// border `PermissionDialog.tsx` uses.
pub fn draw(frame: &mut ratatui::Frame, p: &PendingPermission, area: Rect) {
    let body = render_permission(p);
    let width = 64.min(area.width);
    let height = (body.len() as u16 + 2).min(area.height);
    let x = area.x + (area.width.saturating_sub(width)) / 2;
    let y = area.y + (area.height.saturating_sub(height)) / 2;
    let rect = Rect::new(x, y, width, height);

    frame.render_widget(Clear, rect);
    let widget = Paragraph::new(body)
        .block(
            Block::bordered()
                .border_style(Style::default().fg(Ink::Permission.color()))
                .title(Span::styled(
                    " permission ",
                    Style::default().fg(Ink::Permission.color()),
                )),
        )
        .wrap(Wrap { trim: true });
    frame.render_widget(widget, rect);
}
