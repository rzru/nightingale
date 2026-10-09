use diesel::sql_types::{BigInt, Double, Nullable, Text};
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

pub(crate) type NullableText = Nullable<Text>;

diesel::postfix_operator!(NoCase, " COLLATE NOCASE", Text, backend: diesel::sqlite::Sqlite);
diesel::prefix_operator!(CastOpen, "CAST(", Double, backend: diesel::sqlite::Sqlite);
diesel::postfix_operator!(CastInteger, " AS INTEGER)", BigInt, backend: diesel::sqlite::Sqlite);

pub(super) fn normalize_search(input: &str) -> String {
    input
        .nfd()
        .filter(|character| !is_combining_mark(*character))
        .flat_map(char::to_lowercase)
        .collect()
}

diesel::define_sql_function! {
    fn search_normalize(input: Text) -> Text;
}

diesel::define_sql_function! {
    fn instr(haystack: Text, needle: Text) -> BigInt;
}

diesel::define_sql_function! {
    #[sql_name = "json_extract"]
    fn json_extract_text(json: Text, path: Text) -> NullableText;
}
