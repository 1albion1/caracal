//! Microsoft Entra ID (Azure AD) sign-in for Azure SQL, the way SSMS does it:
//! open the system browser to the Microsoft login page (OAuth2 authorization
//! code + PKCE), catch the redirect on a loopback port, exchange for tokens.
//! Afterwards the refresh token keeps the user signed in silently.

use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Microsoft's well-known public client id for the Azure CLI. It is
/// pre-authorized for Azure SQL (`user_impersonation`) in every tenant and
/// permits loopback redirects, so no app registration is needed.
const CLIENT_ID: &str = "04b07795-8ddb-461a-bbee-02f9e1bf7b46";
/// "organizations" = any work/school account; Azure SQL has no personal accounts.
const AUTHORITY: &str = "https://login.microsoftonline.com/organizations";
/// Note the double slash — the resource URI ends in "/" and ".default" is appended.
const SCOPE: &str = "https://database.windows.net//.default offline_access openid profile";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

pub struct Token {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in_secs: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Silent renewal with a stored refresh token — no browser, no prompts.
pub async fn from_refresh_token(refresh_token: &str) -> Result<Token, String> {
    request_token(&[
        ("client_id", CLIENT_ID),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("scope", SCOPE),
    ])
    .await
}

/// Full interactive sign-in: opens the browser, waits for the redirect.
pub async fn interactive_login(app: &tauri::AppHandle) -> Result<Token, String> {
    use tauri_plugin_opener::OpenerExt;

    // PKCE verifier (64 random hex chars) and S256 challenge.
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = uuid::Uuid::new_v4().to_string();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Could not open a local port for sign-in: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://localhost:{port}");

    // No "prompt" parameter: if the browser already has a Microsoft session,
    // the page completes via SSO and closes itself without user interaction.
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("client_id", CLIENT_ID)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .finish();
    let auth_url = format!("{AUTHORITY}/oauth2/v2.0/authorize?{query}");

    app.opener()
        .open_url(&auth_url, None::<&str>)
        .map_err(|e| format!("Could not open the browser: {e}"))?;

    let code = tokio::time::timeout(LOGIN_TIMEOUT, wait_for_code(&listener, &state))
        .await
        .map_err(|_| "Sign-in timed out after 5 minutes — the browser window was not completed.".to_string())??;

    request_token(&[
        ("client_id", CLIENT_ID),
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", &redirect_uri),
        ("code_verifier", &verifier),
        ("scope", SCOPE),
    ])
    .await
}

async fn request_token(params: &[(&str, &str)]) -> Result<Token, String> {
    let response = reqwest::Client::new()
        .post(format!("{AUTHORITY}/oauth2/v2.0/token"))
        .form(params)
        .send()
        .await
        .map_err(|e| format!("Token request failed: {e}"))?;
    let body: TokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Unexpected token response: {e}"))?;
    match body.access_token {
        Some(access_token) => Ok(Token {
            access_token,
            refresh_token: body.refresh_token,
            expires_in_secs: body.expires_in.unwrap_or(3600),
        }),
        None => Err(body
            .error_description
            .or(body.error)
            .unwrap_or_else(|| "Microsoft sign-in failed.".into())),
    }
}

/// Accepts loopback requests until the OAuth redirect with our state arrives.
/// Stray requests (e.g. favicon) get a placeholder page and are ignored.
async fn wait_for_code(
    listener: &tokio::net::TcpListener,
    expected_state: &str,
) -> Result<String, String> {
    loop {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|e| format!("Sign-in listener failed: {e}"))?;
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).await.unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let path = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or("/")
            .to_string();
        let parsed = match url::Url::parse(&format!("http://localhost{path}")) {
            Ok(u) => u,
            Err(_) => continue,
        };

        let mut code = None;
        let mut state_ok = false;
        let mut error = None;
        for (key, value) in parsed.query_pairs() {
            match key.as_ref() {
                "code" => code = Some(value.into_owned()),
                "state" if value == expected_state => state_ok = true,
                "error_description" => error = Some(value.into_owned()),
                _ => {}
            }
        }

        if let Some(message) = error {
            respond(&mut stream, "Sign-in failed. You can close this window.").await;
            return Err(message);
        }
        if let (Some(code), true) = (code, state_ok) {
            respond(
                &mut stream,
                "Signed in — you can close this window and return to Caracal.",
            )
            .await;
            return Ok(code);
        }
        respond(&mut stream, "Waiting for Microsoft sign-in…").await;
    }
}

const REFRESH_TOKEN_FILE: &str = "entra_token.bin";

/// Persists the refresh token encrypted with DPAPI (per-user Windows
/// encryption). A file is used instead of the Credential Manager because
/// Entra refresh tokens regularly exceed CredMan's ~2.5 KB blob limit —
/// which silently broke "stay signed in" before.
pub fn store_refresh_token(config_dir: &std::path::Path, token: &str) -> Result<(), String> {
    let encrypted = dpapi_protect(token.as_bytes())?;
    std::fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    std::fs::write(config_dir.join(REFRESH_TOKEN_FILE), encrypted)
        .map_err(|e| format!("Could not save sign-in token: {e}"))
}

pub fn load_refresh_token(config_dir: &std::path::Path) -> Option<String> {
    let encrypted = std::fs::read(config_dir.join(REFRESH_TOKEN_FILE)).ok()?;
    let decrypted = dpapi_unprotect(&encrypted).ok()?;
    String::from_utf8(decrypted).ok()
}

fn dpapi_protect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        CryptProtectData(&input, None, None, None, None, 0, &mut output)
            .map_err(|e| format!("Encryption failed: {e}"))?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(output.pbData as _));
        Ok(bytes)
    }
}

fn dpapi_unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        CryptUnprotectData(&input, None, None, None, None, 0, &mut output)
            .map_err(|e| format!("Decryption failed: {e}"))?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(output.pbData as _));
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refresh_token_roundtrip_survives_large_tokens() {
        // Entra refresh tokens are often > 2.5 KB — the reason CredMan failed.
        let token = "t".repeat(4000);
        let dir = std::env::temp_dir().join(format!("dbms-entra-test-{}", std::process::id()));
        store_refresh_token(&dir, &token).expect("store");

        // Stored bytes must be encrypted, not the raw token.
        let raw = std::fs::read(dir.join(REFRESH_TOKEN_FILE)).unwrap();
        assert_ne!(raw, token.as_bytes());

        assert_eq!(load_refresh_token(&dir).as_deref(), Some(token.as_str()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_refresh_token_is_none() {
        assert_eq!(load_refresh_token(std::path::Path::new("C:\\nonexistent-dir-dbms")), None);
    }
}

async fn respond(stream: &mut tokio::net::TcpStream, message: &str) {
    let body = format!(
        "<html><head><meta charset=\"utf-8\"><title>Caracal</title></head>\
         <body style=\"font-family:'Segoe UI',sans-serif;background:#1e1e1e;color:#ccc;\
         display:flex;align-items:center;justify-content:center;height:95vh\">\
         <h3>{message}</h3></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}
