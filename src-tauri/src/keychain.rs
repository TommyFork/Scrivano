use keyring::Entry;

const SERVICE_NAME: &str = "scrivano";

fn get_entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, provider)
        .map_err(|e| format!("Failed to create keychain entry: {}", e))
}

pub fn store_api_key(provider: &str, api_key: &str) -> Result<(), String> {
    let entry = get_entry(provider)?;
    entry
        .set_password(api_key)
        .map_err(|e| format!("Failed to store API key in keychain: {}", e))
}

pub fn get_api_key(provider: &str) -> Option<String> {
    let entry = get_entry(provider).ok()?;
    entry.get_password().ok()
}

pub fn delete_api_key(provider: &str) -> Result<(), String> {
    let entry = get_entry(provider)?;
    entry
        .delete_credential()
        .map_err(|e| format!("Failed to delete API key from keychain: {}", e))
}

#[allow(dead_code)] // used in tests
pub fn has_api_key(provider: &str) -> bool {
    get_api_key(provider).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_PROVIDER: &str = "test_provider_scrivano";

    fn cleanup_test_key() {
        let _ = delete_api_key(TEST_PROVIDER);
    }

    // These tests require macOS Keychain access and may prompt for user authorization.
    // Run with: cargo test -- --ignored --test-threads=1

    #[test]
    #[ignore]
    fn test_store_and_get_api_key() {
        cleanup_test_key();

        let test_key = "test-api-key-12345";
        let result = store_api_key(TEST_PROVIDER, test_key);
        assert!(
            result.is_ok(),
            "Failed to store API key: {:?}",
            result.err()
        );

        let retrieved = get_api_key(TEST_PROVIDER);
        assert_eq!(retrieved, Some(test_key.to_string()));

        cleanup_test_key();
    }

    #[test]
    #[ignore]
    fn test_has_api_key() {
        cleanup_test_key();

        assert!(!has_api_key(TEST_PROVIDER));

        store_api_key(TEST_PROVIDER, "test-key").unwrap();
        assert!(has_api_key(TEST_PROVIDER));

        cleanup_test_key();
        assert!(!has_api_key(TEST_PROVIDER));
    }

    #[test]
    #[ignore]
    fn test_delete_api_key() {
        cleanup_test_key();

        store_api_key(TEST_PROVIDER, "test-key").unwrap();
        assert!(has_api_key(TEST_PROVIDER));

        let result = delete_api_key(TEST_PROVIDER);
        assert!(result.is_ok());
        assert!(!has_api_key(TEST_PROVIDER));
    }

    #[test]
    #[ignore]
    fn test_get_nonexistent_key() {
        cleanup_test_key();
        let retrieved = get_api_key(TEST_PROVIDER);
        assert_eq!(retrieved, None);
    }

    #[test]
    #[ignore]
    fn test_update_existing_key() {
        cleanup_test_key();

        store_api_key(TEST_PROVIDER, "first-key").unwrap();
        assert_eq!(get_api_key(TEST_PROVIDER), Some("first-key".to_string()));

        store_api_key(TEST_PROVIDER, "second-key").unwrap();
        assert_eq!(get_api_key(TEST_PROVIDER), Some("second-key".to_string()));

        cleanup_test_key();
    }

    #[test]
    #[ignore]
    fn test_multiple_providers() {
        cleanup_test_key();
        let _ = delete_api_key("another_test_provider");

        store_api_key(TEST_PROVIDER, "key1").unwrap();
        store_api_key("another_test_provider", "key2").unwrap();

        assert_eq!(get_api_key(TEST_PROVIDER), Some("key1".to_string()));
        assert_eq!(
            get_api_key("another_test_provider"),
            Some("key2".to_string())
        );

        cleanup_test_key();
        let _ = delete_api_key("another_test_provider");
    }
}
