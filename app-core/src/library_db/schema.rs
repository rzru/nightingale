diesel::table! {
    library_meta (id) {
        id -> BigInt,
        folder -> Text,
        scan_count -> BigInt,
    }
}

diesel::table! {
    songs (id) {
        id -> BigInt,
        path -> Text,
        file_hash -> Text,
        title -> Text,
        artist -> Text,
        album -> Text,
        duration_secs -> Double,
        album_art_path -> Nullable<Text>,
        is_analyzed -> Bool,
        language -> Nullable<Text>,
        transcript_source -> Nullable<Text>,
        is_video -> Bool,
        payload -> Text,
    }
}

diesel::table! {
    analysis_queue (file_hash) {
        file_hash -> Text,
        rowid -> BigInt,
        status -> Text,
        analyzing_pct -> Nullable<BigInt>,
        failed_message -> Nullable<Text>,
    }
}

diesel::table! {
    playlists (id) {
        id -> Text,
        name -> Text,
    }
}

diesel::table! {
    playlist_songs (playlist_id, song_id) {
        playlist_id -> Text,
        song_id -> BigInt,
        position -> BigInt,
    }
}

diesel::table! {
    wishes (id) {
        id -> BigInt,
        provider -> Text,
        external_id -> Text,
        title -> Text,
        artist -> Text,
        duration_secs -> Nullable<Double>,
        source_url -> Text,
        status -> Text,
        matched_file_hash -> Nullable<Text>,
        error -> Nullable<Text>,
        added_at -> BigInt,
    }
}

diesel::table! {
    wish_playlists (id) {
        id -> Text,
        provider -> Text,
        external_id -> Text,
        name -> Text,
        imported_at -> BigInt,
    }
}

diesel::table! {
    wish_playlist_items (playlist_id, wish_id) {
        playlist_id -> Text,
        wish_id -> BigInt,
        position -> BigInt,
    }
}

diesel::joinable!(playlist_songs -> playlists (playlist_id));
diesel::joinable!(playlist_songs -> songs (song_id));
diesel::joinable!(wish_playlist_items -> wish_playlists (playlist_id));
diesel::joinable!(wish_playlist_items -> wishes (wish_id));

diesel::allow_tables_to_appear_in_same_query!(
    library_meta,
    songs,
    analysis_queue,
    playlists,
    playlist_songs,
    wishes,
    wish_playlists,
    wish_playlist_items,
);
