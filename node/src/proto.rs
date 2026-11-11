//! Wire contract between a node and Nightingale clients.
//!
//! Everything here is public API: clients mirror these shapes with zod in
//! `client/src/bridge/rooms.ts`, so field names and the protocol number are the
//! compatibility surface.

use serde::{Deserialize, Serialize};

/// Singers per room. One microphone per client, so this also caps clients.
pub(crate) const ROOM_CAPACITY: usize = 4;

/// Bump whenever a client would misread frames from the other side.
pub(crate) const PROTOCOL: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Phase {
    Lobby,
    /// Everyone is loading the track; playback starts when the slowest client
    /// reports ready, or when the arming timeout expires.
    Arming,
    Playing,
}

/// Mirrors `client/src/shared/player-colors.ts`; four colors for four seats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PlayerColor {
    Rose,
    Fuchsia,
    Amber,
    Emerald,
}

impl PlayerColor {
    pub(crate) const ALL: [Self; 4] = [Self::Rose, Self::Fuchsia, Self::Amber, Self::Emerald];

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "rose" => Some(Self::Rose),
            "fuchsia" => Some(Self::Fuchsia),
            "amber" => Some(Self::Amber),
            "emerald" => Some(Self::Emerald),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemberView {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) ready: bool,
    pub(crate) has_track: bool,
    /// Set once this client finished loading the track.
    pub(crate) loaded: bool,
    /// Points for the song being sung right now.
    pub(crate) score: i64,
    /// Songs finished in this room, and points banked from them.
    pub(crate) songs: i64,
    pub(crate) total: i64,
    pub(crate) host: bool,
    pub(crate) color: PlayerColor,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackView {
    pub(crate) hash: String,
    pub(crate) title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RoomView {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) host_id: String,
    pub(crate) members: Vec<MemberView>,
    pub(crate) capacity: usize,
    pub(crate) track: Option<TrackView>,
    pub(crate) phase: Phase,
    /// Unix milliseconds of the shared start. While it lies in the future the
    /// room is counting down; clients schedule their own audio against it.
    pub(crate) start_at_ms: Option<i64>,
    /// Song position at `start_at_ms`, so resumes and seeks keep their offset.
    pub(crate) start_position_ms: i64,
    /// Paused by any singer pauses for the whole room.
    pub(crate) paused: bool,
    /// `paused_by` is the display name; `paused_by_id` decides who may resume.
    pub(crate) paused_by: Option<String>,
    pub(crate) paused_by_id: Option<String>,
    /// Where the room is right now, so a late joiner lands in the same place.
    pub(crate) position_ms: i64,
    pub(crate) locked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RoomSummary {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) host_name: String,
    pub(crate) members: usize,
    pub(crate) capacity: usize,
    pub(crate) ready: usize,
    pub(crate) phase: Phase,
    pub(crate) track_title: Option<String>,
    /// Lets clients resolve the title from their own library instead of
    /// trusting the node's label.
    pub(crate) track_hash: Option<String>,
    pub(crate) locked: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Count {
    pub(crate) used: usize,
    pub(crate) capacity: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodeInfo {
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) protocol: u32,
    pub(crate) public: bool,
    pub(crate) rooms: Count,
    pub(crate) slots: Count,
    pub(crate) uptime_s: u64,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub(crate) enum ServerFrame {
    #[serde(rename = "room.state")]
    RoomState { state: RoomView },
    /// One singer's pitch sample, already in song time and absolute semitones.
    #[serde(rename = "room.pitch")]
    Pitch {
        member_id: String,
        hz: Option<f32>,
        semitone: Option<f32>,
        similarity: f32,
        position_ms: i64,
    },
    #[serde(rename = "room.deny")]
    Deny { reason: &'static str },
    #[serde(rename = "room.closed")]
    Closed { reason: &'static str },
    /// The host skipped; every client seeks to this position.
    #[serde(rename = "room.skip")]
    Skip { kind: String, position_ms: i64 },
    #[serde(rename = "time.pong")]
    Pong { client_ms: i64, server_ms: i64 },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub(crate) enum ClientFrame {
    #[serde(rename = "room.ready")]
    Ready { ready: bool },
    #[serde(rename = "room.has_track")]
    HasTrack { has_track: bool },
    #[serde(rename = "room.track")]
    Track { hash: String, title: String },
    #[serde(rename = "room.leave")]
    Leave,
    #[serde(rename = "room.color")]
    Color { color: String },
    #[serde(rename = "room.loaded")]
    Loaded,
    /// The host's own intro target, so every client seeks to the same place.
    #[serde(rename = "room.skip_intro")]
    SkipIntro { position_ms: i64 },
    #[serde(rename = "room.skip_outro")]
    SkipOutro,
    #[serde(rename = "room.seek")]
    Seek { position_ms: i64 },
    #[serde(rename = "room.pause")]
    Pause,
    #[serde(rename = "room.resume")]
    Resume,
    #[serde(rename = "room.start")]
    Start,
    #[serde(rename = "room.end")]
    End,
    #[serde(rename = "room.pitch")]
    Pitch {
        hz: Option<f32>,
        semitone: Option<f32>,
        similarity: f32,
        position_ms: i64,
    },
    #[serde(rename = "room.score")]
    Score { score: i64 },
    #[serde(rename = "time.ping")]
    Ping { client_ms: i64 },
}
