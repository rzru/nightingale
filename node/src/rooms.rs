//! Room state for a community node: lobbies of up to four singers sharing one
//! track, password-gated and ready-gated.
//!
//! The node never touches audio or media. Singers keep their own copy of the
//! track, so a room only coordinates *who* sings *what* and *when* the shared
//! start happens.

use std::{
    collections::HashMap,
    fmt::Write as _,
    net::IpAddr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use tokio::sync::{broadcast, RwLock};

use crate::proto::{
    MemberView, Phase, RoomSummary, RoomView, ServerFrame, TrackView, ROOM_CAPACITY,
};

/// Lead time broadcast with [`Phase::Playing`] so every client can load the
/// track, align its clock, and start on the same beat.
const COUNTDOWN_MS: i64 = 8_000;

/// A singer keeps their seat while they move between the room screen and the
/// playback surface, which are separate sockets (and, on desktop, separate
/// windows). Their seat is released once every socket has been gone this long.
const MEMBER_GRACE: Duration = Duration::from_secs(20);
const TOKEN_BYTES: usize = 16;
const JOIN_WINDOW: Duration = Duration::from_secs(60);
const JOIN_ATTEMPTS: u32 = 5;
const MAX_SCORE: i64 = 1_000_000;
const MAX_NAME_CHARS: usize = 32;
const MAX_ROOM_NAME_CHARS: usize = 60;

#[derive(Debug, Clone, Copy)]
pub(crate) struct Limits {
    pub(crate) max_rooms: usize,
    pub(crate) max_slots: usize,
}

#[derive(Debug)]
pub(crate) enum RoomError {
    AtCapacity,
    NotFound,
    Full,
    InPlayback,
    NotHost,
    NoTrack,
    TrackUnset,
    NotReady,
    BadPassword,
    Denied,
    RateLimited,
    Invalid,
    Internal,
}

impl RoomError {
    /// Stable machine-readable tag shared with clients (`room.deny.reason`).
    pub(crate) fn reason(&self) -> &'static str {
        match self {
            Self::AtCapacity => "at-capacity",
            Self::NotFound => "not-found",
            Self::Full => "full",
            Self::InPlayback => "in-playback",
            Self::NotHost => "not-host",
            Self::NoTrack => "no-track",
            Self::TrackUnset => "track-unset",
            Self::NotReady => "not-ready",
            Self::BadPassword => "bad-password",
            Self::Denied => "denied",
            Self::RateLimited => "rate-limited",
            Self::Invalid => "invalid",
            Self::Internal => "internal",
        }
    }
}

pub(crate) struct Issued {
    pub(crate) room_id: String,
    pub(crate) member_id: String,
    pub(crate) token: String,
}

struct Attempts {
    count: u32,
    since: Instant,
}

struct Member {
    id: String,
    name: String,
    token: String,
    ready: bool,
    has_track: bool,
    score: i64,
    /// Live sockets for this member. The room screen and the playback surface
    /// each hold one.
    sockets: u32,
    last_seen: Instant,
}

impl Member {
    fn new(name: String) -> Result<Self, RoomError> {
        let id = random_token(8)?;
        let token = random_token(TOKEN_BYTES)?;

        Ok(Self {
            id,
            name,
            token,
            ready: false,
            has_track: false,
            score: 0,
            sockets: 0,
            last_seen: Instant::now(),
        })
    }
}

struct RoomState {
    name: String,
    password: Option<String>,
    host: String,
    members: Vec<Member>,
    track: Option<TrackView>,
    phase: Phase,
    start_at_ms: Option<i64>,
}

impl RoomState {
    fn view(&self, id: &str) -> RoomView {
        RoomView {
            id: id.to_owned(),
            name: self.name.clone(),
            host_id: self.host.clone(),
            members: self
                .members
                .iter()
                .map(|member| MemberView {
                    id: member.id.clone(),
                    name: member.name.clone(),
                    ready: Self::is_ready(member, &self.host),
                    has_track: member.has_track,
                    score: member.score,
                    host: member.id == self.host,
                })
                .collect(),
            capacity: ROOM_CAPACITY,
            track: self.track.clone(),
            phase: self.phase,
            start_at_ms: self.start_at_ms,
            locked: self.password.is_some(),
        }
    }

    fn summary(&self, id: &str) -> RoomSummary {
        RoomSummary {
            id: id.to_owned(),
            name: self.name.clone(),
            host_name: self
                .members
                .iter()
                .find(|member| member.id == self.host)
                .map_or_else(String::new, |member| member.name.clone()),
            members: self.members.len(),
            capacity: ROOM_CAPACITY,
            ready: self
                .members
                .iter()
                .filter(|member| Self::is_ready(member, &self.host))
                .count(),
            phase: self.phase,
            track_title: self.track.as_ref().map(|track| track.title.clone()),
            track_hash: self.track.as_ref().map(|track| track.hash.clone()),
            locked: self.password.is_some(),
        }
    }

    fn member_mut(&mut self, id: &str) -> Result<&mut Member, RoomError> {
        self.members
            .iter_mut()
            .find(|member| member.id == id)
            .ok_or(RoomError::Denied)
    }

    /// Host-only mutations that make no sense mid-playback.
    fn host_lobby(&mut self, member_id: &str) -> Result<(), RoomError> {
        if self.host != member_id {
            return Err(RoomError::NotHost);
        }
        if self.phase != Phase::Lobby {
            return Err(RoomError::InPlayback);
        }

        Ok(())
    }

    /// Reset the ready gate after a track change. The host stays ready: they
    /// own the track and press start, so asking them to ready up is noise.
    fn clear_ready(&mut self) {
        for member in &mut self.members {
            member.ready = false;
            member.has_track = false;
        }
    }

    /// The host is ready by definition, and a singer without the track is a
    /// spectator, not a blocker.
    fn is_ready(member: &Member, host: &str) -> bool {
        member.id == host || member.ready
    }

    fn gates_start(&self, member: &Member) -> bool {
        member.id != self.host && member.has_track && !member.ready
    }
}

pub(crate) struct Room {
    id: String,
    state: RwLock<RoomState>,
    events: broadcast::Sender<Arc<str>>,
    closed: AtomicBool,
}

impl Room {
    fn new(id: String, state: RoomState) -> Self {
        let (events, _) = broadcast::channel(256);

        Self {
            id,
            state: RwLock::new(state),
            events,
            closed: AtomicBool::new(false),
        }
    }

    pub(crate) fn id(&self) -> &str {
        &self.id
    }

    pub(crate) fn subscribe(&self) -> broadcast::Receiver<Arc<str>> {
        self.events.subscribe()
    }

    pub(crate) async fn view(&self) -> RoomView {
        let state = self.state.read().await;

        state.view(&self.id)
    }

    async fn summary(&self) -> RoomSummary {
        let state = self.state.read().await;

        state.summary(&self.id)
    }

    pub(crate) async fn member_count(&self) -> usize {
        self.state.read().await.members.len()
    }

    fn send(&self, frame: &ServerFrame) {
        if let Ok(text) = serde_json::to_string(frame) {
            let _ = self.events.send(Arc::from(text));
        }
    }

    pub(crate) async fn broadcast_view(&self) {
        let view = self.view().await;

        self.send(&ServerFrame::RoomState { state: view });
    }

    /// Pitch is fanout-only: never stored, so a burst of frames cannot grow
    /// node memory beyond the broadcast buffer.
    pub(crate) fn broadcast_pitch(&self, member_id: &str, hz: Option<f32>, rms: Option<f32>) {
        self.send(&ServerFrame::Pitch {
            member_id: member_id.to_owned(),
            hz,
            rms,
        });
    }

    pub(crate) fn deny(&self, error: &RoomError) {
        self.send(&ServerFrame::Deny {
            reason: error.reason(),
        });
    }

    pub(crate) fn close(&self, reason: &'static str) {
        self.closed.store(true, Ordering::Relaxed);
        self.send(&ServerFrame::Closed { reason });
    }

    pub(crate) async fn set_ready(&self, member_id: &str, ready: bool) -> Result<(), RoomError> {
        {
            let mut state = self.state.write().await;
            if state.phase != Phase::Lobby {
                return Err(RoomError::InPlayback);
            }
            let is_host = state.host == member_id;
            let member = state.member_mut(member_id)?;
            if is_host {
                // Nothing for the host to toggle: readiness is derived.
                return Ok(());
            }
            if ready && !member.has_track {
                return Err(RoomError::NoTrack);
            }
            member.ready = ready;
        }
        self.broadcast_view().await;

        Ok(())
    }

    pub(crate) async fn set_has_track(
        &self,
        member_id: &str,
        has_track: bool,
    ) -> Result<(), RoomError> {
        {
            let mut state = self.state.write().await;
            let is_host = state.host == member_id;
            let member = state.member_mut(member_id)?;
            member.has_track = has_track;
            if !has_track && !is_host {
                member.ready = false;
            }
        }
        self.broadcast_view().await;

        Ok(())
    }

    pub(crate) async fn set_track(
        &self,
        member_id: &str,
        hash: &str,
        title: &str,
    ) -> Result<(), RoomError> {
        let hash = hash.trim();
        if hash.is_empty() || hash.chars().count() > 128 {
            return Err(RoomError::Invalid);
        }
        let title = clamp(title, MAX_ROOM_NAME_CHARS);
        {
            let mut state = self.state.write().await;
            state.host_lobby(member_id)?;
            state.track = Some(TrackView {
                hash: hash.to_owned(),
                title,
            });
            state.start_at_ms = None;
            state.clear_ready();
        }
        self.broadcast_view().await;

        Ok(())
    }

    pub(crate) async fn start(&self, member_id: &str) -> Result<(), RoomError> {
        {
            let mut state = self.state.write().await;
            state.host_lobby(member_id)?;
            if state.track.is_none() {
                return Err(RoomError::TrackUnset);
            }
            if state.members.iter().any(|member| state.gates_start(member)) {
                return Err(RoomError::NotReady);
            }
            state.phase = Phase::Playing;
            state.start_at_ms = Some(now_ms() + COUNTDOWN_MS);
        }
        self.broadcast_view().await;

        Ok(())
    }

    pub(crate) async fn end(&self, member_id: &str) -> Result<(), RoomError> {
        {
            let mut state = self.state.write().await;
            state.host_lobby(member_id)?;
            state.phase = Phase::Lobby;
            state.start_at_ms = None;
            state.clear_ready();
        }
        self.broadcast_view().await;

        Ok(())
    }

    pub(crate) async fn add_score(&self, member_id: &str, delta: i64) -> Result<(), RoomError> {
        {
            let mut state = self.state.write().await;
            let member = state.member_mut(member_id)?;
            member.score = (member.score + delta).clamp(0, MAX_SCORE);
        }
        self.broadcast_view().await;

        Ok(())
    }

    pub(crate) async fn attach(&self, member_id: &str) -> Result<(), RoomError> {
        let mut state = self.state.write().await;
        let member = state.member_mut(member_id)?;
        member.sockets = member.sockets.saturating_add(1);
        member.last_seen = Instant::now();

        Ok(())
    }

    /// Drop a seat immediately, without waiting for the grace window. Returns
    /// `true` when that seat was the last one, so the caller can remove the room.
    pub(crate) async fn release(&self, member_id: &str) -> bool {
        let mut state = self.state.write().await;
        let before = state.members.len();
        state.members.retain(|member| member.id != member_id);
        if state.members.len() == before {
            return false;
        }
        if !state.members.iter().any(|member| member.id == state.host) {
            state.host = state
                .members
                .first()
                .map_or_else(String::new, |member| member.id.clone());
            state.clear_ready();
        }
        let emptied = state.members.is_empty();
        drop(state);
        self.broadcast_view().await;

        emptied
    }

    pub(crate) async fn detach(&self, member_id: &str) {
        let mut state = self.state.write().await;
        if let Some(member) = state
            .members
            .iter_mut()
            .find(|member| member.id == member_id)
        {
            member.sockets = member.sockets.saturating_sub(1);
            member.last_seen = Instant::now();
        }
    }

    /// Drop seats whose sockets are all gone, and hand the room to the next
    /// singer instead of killing it when the host leaves.
    async fn prune_members(&self) -> bool {
        let mut state = self.state.write().await;
        let before = state.members.len();
        state
            .members
            .retain(|member| member.sockets > 0 || member.last_seen.elapsed() <= MEMBER_GRACE);
        let changed = state.members.len() != before;
        if changed && !state.members.iter().any(|member| member.id == state.host) {
            state.host = state
                .members
                .first()
                .map_or_else(String::new, |member| member.id.clone());
            state.clear_ready();
        }
        let emptied = state.members.is_empty();
        drop(state);
        if changed {
            self.broadcast_view().await;
        }

        emptied
    }
}

pub(crate) struct RoomStore {
    limits: Limits,
    rooms: RwLock<HashMap<String, Arc<Room>>>,
    attempts: Mutex<HashMap<IpAddr, Attempts>>,
}

impl RoomStore {
    pub(crate) fn new(limits: Limits) -> Self {
        Self {
            limits,
            rooms: RwLock::new(HashMap::new()),
            attempts: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn limits(&self) -> Limits {
        self.limits
    }

    pub(crate) async fn create(
        &self,
        host_name: &str,
        room_name: &str,
        password: Option<&str>,
    ) -> Result<Issued, RoomError> {
        let host_name = display_name(host_name)?;
        let room_name = clamp(room_name.trim(), MAX_ROOM_NAME_CHARS);
        if room_name.is_empty() {
            return Err(RoomError::Invalid);
        }
        let password = match password.map(str::trim).filter(|value| !value.is_empty()) {
            Some(password) => Some(hash_password(password.to_owned()).await?),
            None => None,
        };

        let host = Member::new(host_name)?;
        let issued = Issued {
            room_id: random_token(TOKEN_BYTES)?,
            member_id: host.id.clone(),
            token: host.token.clone(),
        };
        let room = Arc::new(Room::new(
            issued.room_id.clone(),
            RoomState {
                name: room_name,
                password,
                host: host.id.clone(),
                members: vec![host],
                track: None,
                phase: Phase::Lobby,
                start_at_ms: None,
            },
        ));

        {
            let mut rooms = self.rooms.write().await;
            if rooms.len() >= self.limits.max_rooms {
                return Err(RoomError::AtCapacity);
            }
            if slots_used(&rooms).await >= self.limits.max_slots {
                return Err(RoomError::AtCapacity);
            }
            rooms.insert(issued.room_id.clone(), room);
        }

        Ok(issued)
    }

    pub(crate) async fn join(
        &self,
        ip: IpAddr,
        room_id: &str,
        name: &str,
        password: Option<&str>,
    ) -> Result<Issued, RoomError> {
        let name = display_name(name)?;
        let room = self
            .rooms
            .read()
            .await
            .get(room_id)
            .cloned()
            .ok_or(RoomError::NotFound)?;

        let stored = { room.state.read().await.password.clone() };
        if let Some(stored) = stored {
            self.check_attempt(ip)?;
            let provided = password.unwrap_or_default().to_owned();
            if !verify_password(provided, stored).await? {
                return Err(RoomError::BadPassword);
            }
            self.clear_attempt(ip);
        }

        {
            let rooms = self.rooms.read().await;
            if slots_used(&rooms).await >= self.limits.max_slots {
                return Err(RoomError::AtCapacity);
            }
        }

        let member = Member::new(name)?;
        let issued = Issued {
            room_id: room.id.clone(),
            member_id: member.id.clone(),
            token: member.token.clone(),
        };

        {
            let mut state = room.state.write().await;
            if state.members.len() >= ROOM_CAPACITY {
                return Err(RoomError::Full);
            }
            // A room that lost its host (or emptied) adopts the joiner, so the
            // lobby can always be started.
            if !state
                .members
                .iter()
                .any(|existing| existing.id == state.host)
            {
                state.host = member.id.clone();
                state.clear_ready();
            }
            state.members.push(member);
        }
        room.broadcast_view().await;

        Ok(issued)
    }

    /// Resolve a WebSocket handshake into a room plus the member it belongs to.
    pub(crate) async fn authenticate(
        &self,
        room_id: &str,
        token: &str,
    ) -> Result<(Arc<Room>, String), RoomError> {
        let room = self
            .rooms
            .read()
            .await
            .get(room_id)
            .cloned()
            .ok_or(RoomError::NotFound)?;
        let state = room.state.read().await;
        let member = state
            .members
            .iter()
            .find(|member| tokens_match(&member.token, token))
            .map(|member| member.id.clone())
            .ok_or(RoomError::Denied)?;
        drop(state);

        Ok((room, member))
    }

    pub(crate) async fn remove(&self, room_id: &str) {
        self.rooms.write().await.remove(room_id);
    }

    pub(crate) async fn summaries(&self) -> Vec<RoomSummary> {
        let rooms = self.rooms.read().await;
        let mut summaries = Vec::with_capacity(rooms.len());
        for room in rooms.values() {
            summaries.push(room.summary().await);
        }
        summaries.sort_by(|left, right| left.name.cmp(&right.name));

        summaries
    }

    pub(crate) async fn counts(&self) -> (usize, usize) {
        let rooms = self.rooms.read().await;

        (rooms.len(), slots_used(&rooms).await)
    }

    /// Drop rooms nobody is sitting in, and stale rate-limit counters.
    pub(crate) async fn sweep(&self) {
        let mut orphaned: Vec<Arc<Room>> = Vec::new();
        {
            let rooms = self.rooms.read().await;
            for room in rooms.values() {
                if room.prune_members().await {
                    orphaned.push(Arc::clone(room));
                }
            }
        }

        // An orphan room is one nobody is sitting in: delete it instead of
        // letting an unstartable, host-less shell linger in the room list.
        for room in orphaned {
            room.close("empty");
            self.remove(room.id()).await;
            tracing::debug!(room = room.id(), "removed empty room");
        }

        if let Ok(mut attempts) = self.attempts.lock() {
            attempts.retain(|_, entry| entry.since.elapsed() < JOIN_WINDOW);
        }
    }

    fn check_attempt(&self, ip: IpAddr) -> Result<(), RoomError> {
        let mut attempts = self.attempts.lock().map_err(|_| RoomError::Internal)?;
        let now = Instant::now();
        let entry = attempts.entry(ip).or_insert(Attempts {
            count: 0,
            since: now,
        });
        if entry.since.elapsed() > JOIN_WINDOW {
            entry.count = 0;
            entry.since = now;
        }
        if entry.count >= JOIN_ATTEMPTS {
            return Err(RoomError::RateLimited);
        }
        entry.count += 1;

        Ok(())
    }

    fn clear_attempt(&self, ip: IpAddr) {
        if let Ok(mut attempts) = self.attempts.lock() {
            attempts.remove(&ip);
        }
    }
}

async fn slots_used(rooms: &HashMap<String, Arc<Room>>) -> usize {
    let mut used = 0;
    for room in rooms.values() {
        used += room.member_count().await;
    }

    used
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

fn display_name(value: &str) -> Result<String, RoomError> {
    let name = clamp(value.trim(), MAX_NAME_CHARS);
    if name.is_empty() {
        return Err(RoomError::Invalid);
    }

    Ok(name)
}

fn clamp(value: &str, max: usize) -> String {
    value
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect()
}

fn tokens_match(left: &str, right: &str) -> bool {
    left.len() == right.len()
        && left
            .bytes()
            .zip(right.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

fn random_token(bytes: usize) -> Result<String, RoomError> {
    let mut raw = vec![0u8; bytes];
    getrandom::fill(&mut raw).map_err(|_| RoomError::Internal)?;
    let mut text = String::with_capacity(bytes * 2);
    for byte in raw {
        let _ = write!(text, "{byte:02x}");
    }

    Ok(text)
}

async fn hash_password(password: String) -> Result<String, RoomError> {
    tokio::task::spawn_blocking(move || {
        let mut salt_bytes = [0u8; 16];
        getrandom::fill(&mut salt_bytes).map_err(|_| RoomError::Internal)?;
        let salt = SaltString::encode_b64(&salt_bytes).map_err(|_| RoomError::Internal)?;
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
            .map_err(|_| RoomError::Internal)
    })
    .await
    .map_err(|_| RoomError::Internal)?
}

async fn verify_password(password: String, stored: String) -> Result<bool, RoomError> {
    tokio::task::spawn_blocking(move || {
        let Ok(parsed) = PasswordHash::new(&stored) else {
            return false;
        };

        Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok()
    })
    .await
    .map_err(|_| RoomError::Internal)
}
