use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Clear, Paragraph, Wrap};
use ratatui::Frame;

use crate::message;
use crate::state::UiState;
use crate::theme::Ink;

/// Draw the whole screen: transcript, permission overlay, input, status.
pub fn render(frame: &mut Frame, state: &UiState) {
    let area = frame.area();
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(3),
            Constraint::Length(1),
            Constraint::Length(1),
        ])
        .split(area);

    draw_transcript(frame, state, chunks[0]);
    draw_input(frame, state, chunks[1]);
    draw_status(frame, state, chunks[2]);

    if state.permission.is_some() {
        draw_permission(frame, state);
    }
}

fn draw_transcript(frame: &mut Frame, state: &UiState, area: Rect) {
    let mut lines: Vec<Line<'static>> = Vec::new();
    for m in message::render_transcript(state) {
        lines.extend(m);
    }
    if lines.is_empty() {
        lines.push(Line::from(Span::styled(
            " (no messages yet) ",
            Style::default().fg(Ink::Dim.color()),
        )));
    }

    // Auto-follow: keep the bottom pinned while new output streams in.
    let visible = area.height.saturating_sub(2) as usize;
    let scroll = if lines.len() > visible && state.follow_bottom {
        lines.len() - visible
    } else {
        0
    };

    let title = if state.title.is_empty() {
        " ccb ".to_string()
    } else {
        format!(" {} ", state.title)
    };
    let widget = Paragraph::new(lines)
        .block(Block::default().title(title))
        .wrap(Wrap { trim: true })
        .scroll((scroll as u16, 0));
    frame.render_widget(widget, area);
}

fn draw_input(frame: &mut Frame, state: &UiState, area: Rect) {
    let shown = if state.input.is_empty() {
        Span::styled(
            "(type a prompt, enter to send · up/down = history)",
            Style::default().fg(Color::DarkGray),
        )
    } else {
        Span::raw(state.input.clone())
    };
    let widget = Paragraph::new(Line::from(vec![
        Span::styled("> ", Style::default().fg(Color::Yellow)),
        shown,
    ]))
    .block(Block::default().border_style(Style::default().fg(Color::DarkGray)));
    frame.render_widget(widget, area);
}

fn draw_status(frame: &mut Frame, state: &UiState, area: Rect) {
    let session = state
        .session_id
        .as_deref()
        .map(|s| s.chars().take(8).collect::<String>())
        .unwrap_or_else(|| "connecting".to_string());

    let mut spans: Vec<Span> = vec![
        // The agent's own state word (running/idle/requires_action) when known.
        Span::styled(
            {
                let state_word = if state.agent_state.is_empty() {
                    if state.busy { "busy" } else { "idle" }
                } else {
                    state.agent_state.as_str()
                };
                format!("{state_word} · session {session} ")
            },
            Style::default().fg(Color::DarkGray),
        ),
    ];
    if let Some((used, size, cost)) = state.usage {
        spans.push(Span::styled(
            format!("· {} / {} tokens ", used, size),
            Style::default().fg(Color::Blue),
        ));
        if let Some(usd) = cost {
            spans.push(Span::styled(
                format!("· ${usd:.4} "),
                Style::default().fg(Color::Blue),
            ));
        }
    }
    if !state.status.is_empty() {
        spans.push(Span::styled(format!("· {} ", state.status), Style::default().fg(Color::Red)));
    }
    spans.push(Span::styled(
        "· enter=send · q=quit",
        Style::default().fg(Color::DarkGray),
    ));
    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

/// Centered approval dialog over the transcript while the turn is blocked.
fn draw_permission(frame: &mut Frame, state: &UiState) {
    let perm = match &state.permission {
        Some(p) => p,
        None => return,
    };
    let area = frame.area();
    let height = (perm.options.len() as u16 + 6).min(area.height.saturating_sub(4));
    let width = area.width.saturating_sub(8).max(40);
    let popup = centered(width, height, area);

    frame.render_widget(Clear, popup);
    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(vec![Span::styled(
        format!(" {} ", perm.title),
        Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
    )]));
    if let Some(tool) = &perm.tool_name {
        lines.push(Line::from(vec![Span::styled(
            format!(" tool: {tool} "),
            Style::default().fg(Color::Gray),
        )]));
    }
    if let Some(desc) = &perm.description {
        lines.push(Line::from(vec![Span::styled(
            format!(" {desc} "),
            Style::default().fg(Color::Gray),
        )]));
    }
    lines.push(Line::from(""));
    for (idx, opt) in perm.options.iter().enumerate() {
        let marker = if idx == perm.selected { " ▸ " } else { "   " };
        let style = if idx == perm.selected {
            Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::Gray)
        };
        lines.push(Line::from(vec![Span::styled(
            format!("{marker}{}  [{}]", opt.name, opt.kind),
            style,
        )]));
    }
    lines.push(Line::from(""));
    lines.push(Line::from(vec![Span::styled(
        " ↑/↓ or 1-9 to choose · enter to confirm · esc to reject ",
        Style::default().fg(Color::DarkGray),
    )]));

    let widget = Paragraph::new(lines)
        .block(Block::default().borders(ratatui::widgets::Borders::ALL))
        .wrap(Wrap { trim: true });
    frame.render_widget(widget, popup);
}

fn centered(width: u16, height: u16, area: Rect) -> Rect {
    let x = area.x + (area.width.saturating_sub(width)) / 2;
    let y = area.y + (area.height.saturating_sub(height)) / 2;
    Rect::new(x, y, width.min(area.width), height.min(area.height))
}
