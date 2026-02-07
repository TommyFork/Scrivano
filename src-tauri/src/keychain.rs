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

pub fn has_api_key(provider: &str) -> bool {
    get_api_key(provider).is_some()
}
