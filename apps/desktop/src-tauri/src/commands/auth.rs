use cord_core::accounts::AuthUser;
use serde_json::{json, Value};
use tauri::State;

use crate::core::{run, Core, Shared};
use crate::dto::{ChangePasswordIn, Credentials, PasswordIn, RecoverIn, SetPinIn, UnlockPinIn, DONE};

// Signing in opens the user's data; locking closes it.
fn signed_in(c: &Core, user: AuthUser) -> Result<AuthUser, String> {
    c.sign_in(&user.id)?;
    Ok(user)
}

#[tauri::command]
pub async fn auth_lock_screen(core: State<'_, Shared>) -> Result<Value, String> {
    run(&core, |c| c.accounts(|a| a.lock_screen())).await
}

#[tauri::command]
pub async fn auth_current(core: State<'_, Shared>) -> Result<Value, String> {
    run(&core, |c| match c.user_id() {
        Some(id) => c.accounts(|a| a.user(&id)),
        None => Ok(None),
    })
    .await
}

#[tauri::command]
pub async fn auth_register(core: State<'_, Shared>, data: Credentials) -> Result<Value, String> {
    run(&core, move |c| {
        let user = c.accounts(|a| a.register(&data.username, &data.password))?;
        signed_in(c, user)
    })
    .await
}

#[tauri::command]
pub async fn auth_login(core: State<'_, Shared>, data: Credentials) -> Result<Value, String> {
    run(&core, move |c| {
        let user = c.accounts(|a| a.login(&data.username, &data.password))?;
        signed_in(c, user)
    })
    .await
}

#[tauri::command]
pub async fn auth_unlock_pin(core: State<'_, Shared>, data: UnlockPinIn) -> Result<Value, String> {
    run(&core, move |c| {
        let result = c.accounts(|a| a.unlock_with_pin(&data.user_id, &data.pin))?;
        if let Some(user) = &result.user {
            c.sign_in(&user.id)?;
        }
        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn auth_set_pin(core: State<'_, Shared>, data: SetPinIn) -> Result<Value, String> {
    run(&core, move |c| {
        let id = c.me()?;
        c.accounts(|a| a.set_pin(&id, &data.pin, data.password.as_deref()))
    })
    .await
}

#[tauri::command]
pub async fn auth_verify_password(core: State<'_, Shared>, data: PasswordIn) -> Result<Value, String> {
    run(&core, move |c| {
        let id = c.me()?;
        c.accounts(|a| a.verify_password(&id, data.password.as_deref().unwrap_or_default()))?;
        Ok(DONE)
    })
    .await
}

#[tauri::command]
pub async fn auth_change_password(core: State<'_, Shared>, data: ChangePasswordIn) -> Result<Value, String> {
    run(&core, move |c| {
        let id = c.me()?;
        c.accounts(|a| a.change_password(&id, &data.current_password, &data.new_password))?;
        Ok(DONE)
    })
    .await
}

#[tauri::command]
pub async fn auth_issue_recovery_key(core: State<'_, Shared>, data: PasswordIn) -> Result<Value, String> {
    run(&core, move |c| {
        let id = c.me()?;
        let key = c.accounts(|a| a.issue_recovery_key(&id, data.password.as_deref()))?;
        Ok(json!({ "recoveryKey": key }))
    })
    .await
}

#[tauri::command]
pub async fn auth_recover(core: State<'_, Shared>, data: RecoverIn) -> Result<Value, String> {
    run(&core, move |c| {
        let user = c.accounts(|a| a.recover(&data.username, &data.recovery_key, &data.new_password))?;
        signed_in(c, user)
    })
    .await
}

#[tauri::command]
pub async fn auth_lock(core: State<'_, Shared>) -> Result<Value, String> {
    run(&core, |c| {
        c.sign_out();
        Ok(DONE)
    })
    .await
}
