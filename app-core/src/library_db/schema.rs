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
        genre -> Text,
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

diesel::joinable!(playlist_songs -> playlists (playlist_id));
diesel::joinable!(playlist_songs -> songs (song_id));

diesel::allow_tables_to_appear_in_same_query!(
    library_meta,
    songs,
    analysis_queue,
    playlists,
    playlist_songs,
);
