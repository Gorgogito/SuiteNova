use super::account::{Account, AuthKind};
use std::fs;
use std::path::{Path, PathBuf};

const SERVICE: &str = "SuiteNova Mail";

/// Contraseñas en el almacén seguro del sistema (Windows: Administrador de credenciales; macOS: Llavero; Linux: Secret Service).
/// El código de la página nunca puede leerlas: solo Rust las usa, y solo para el servidor guardado de la cuenta.
pub trait Secrets {
    fn set(&self, id: &str, password: &str) -> Result<(), String>;
    fn get(&self, id: &str) -> Result<Option<String>, String>;
    fn delete(&self, id: &str) -> Result<(), String>;
}

pub struct SystemSecrets;

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
impl Secrets for SystemSecrets {
    fn set(&self, id: &str, password: &str) -> Result<(), String> {
        keyring::Entry::new(SERVICE, id)
            .and_then(|e| e.set_password(password))
            .map_err(|e| format!("No se pudo guardar la contraseña en el almacén seguro del sistema: {e}"))
    }
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        match keyring::Entry::new(SERVICE, id).and_then(|e| e.get_password()) {
            Ok(p) => Ok(Some(p)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("No se pudo leer la contraseña del almacén seguro del sistema: {e}")),
        }
    }
    fn delete(&self, id: &str) -> Result<(), String> {
        match keyring::Entry::new(SERVICE, id).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("No se pudo borrar la contraseña del almacén seguro del sistema: {e}")),
        }
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
impl Secrets for SystemSecrets {
    fn set(&self, _: &str, _: &str) -> Result<(), String> {
        Err(format!("{SERVICE}: este sistema no tiene almacén seguro de contraseñas."))
    }
    fn get(&self, _: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    fn delete(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
}

/// Lista de cuentas (sin contraseñas) en un archivo de datos de la aplicación.
pub struct Accounts {
    path: PathBuf,
}

impl Accounts {
    pub fn new(dir: &Path) -> Accounts {
        Accounts { path: dir.join("mail-accounts.json") }
    }

    pub fn list(&self) -> Result<Vec<Account>, String> {
        match fs::read_to_string(&self.path) {
            Ok(s) => serde_json::from_str(&s).map_err(|_| "La lista de cuentas de correo está dañada.".to_string()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
            Err(e) => Err(format!("No se pudo leer la lista de cuentas: {e}")),
        }
    }

    fn write(&self, list: &[Account]) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear la carpeta de datos: {e}"))?;
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?).map_err(|e| format!("No se pudo guardar la lista de cuentas: {e}"))?;
        fs::rename(&tmp, &self.path).map_err(|e| format!("No se pudo guardar la lista de cuentas: {e}"))
    }

    pub fn get(&self, id: &str) -> Result<Account, String> {
        self.list()?.into_iter().find(|a| a.id == id).ok_or_else(|| "La cuenta no existe.".to_string())
    }

    /// Guarda o actualiza una cuenta. Si cambia el servidor o el usuario hace falta escribir la contraseña otra vez (o volver a
    /// iniciar sesión con OAuth), para que nada pueda redirigir una credencial ya guardada hacia otro destino.
    pub fn save(&self, account: Account, password: Option<&str>, secrets: &dyn Secrets) -> Result<(), String> {
        account.validate()?;
        let mut list = self.list()?;
        let existing = list.iter().position(|a| a.id == account.id);
        let oauth = account.auth.kind == AuthKind::Oauth;
        let changed = existing.map_or(true, |i| list[i].changes_destination(&account));
        if oauth {
            if password.is_some() {
                return Err("Una cuenta con OAuth no usa contraseña.".into());
            }
            // con OAuth, un destino nuevo o cambiado exige haber iniciado sesión justo con esta configuración
            if changed && !super::auth::logged_in_with(&account) {
                return Err("Inicia sesión con el proveedor antes de guardar la cuenta.".into());
            }
        } else {
            match (existing, password) {
                (Some(_), None) if changed => return Err("Al cambiar el servidor, el puerto, el protocolo o el usuario hay que escribir la contraseña de nuevo.".into()),
                (None, None) => return Err("Escribe la contraseña de la cuenta.".into()),
                _ => {}
            }
            if let Some(p) = password {
                if p.is_empty() || p.len() > 1024 || p.contains('\0') {
                    return Err("La contraseña no es válida.".into());
                }
                secrets.set(&account.id, p)?;
            }
        }
        match existing {
            Some(i) => list[i] = account,
            None => list.push(account),
        }
        self.write(&list)
    }

    pub fn remove(&self, id: &str, secrets: &dyn Secrets) -> Result<(), String> {
        let mut list = self.list()?;
        list.retain(|a| a.id != id);
        secrets.delete(id)?;
        super::auth::forget(id, secrets)?;
        self.write(&list)
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::mail::account::{Security, Server};
    use std::cell::RefCell;
    use std::collections::HashMap;

    #[derive(Default)]
    pub struct MemorySecrets(pub RefCell<HashMap<String, String>>);
    impl Secrets for MemorySecrets {
        fn set(&self, id: &str, p: &str) -> Result<(), String> {
            self.0.borrow_mut().insert(id.into(), p.into());
            Ok(())
        }
        fn get(&self, id: &str) -> Result<Option<String>, String> {
            Ok(self.0.borrow().get(id).cloned())
        }
        fn delete(&self, id: &str) -> Result<(), String> {
            self.0.borrow_mut().remove(id);
            Ok(())
        }
    }

    pub fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("suitenova-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    fn acct() -> Account {
        Account {
            id: "a1".into(),
            name: "Prueba".into(),
            email: "ana@ejemplo.es".into(),
            username: "ana".into(),
            imap: Server { host: "imap.ejemplo.es".into(), port: 993, security: Security::Tls },
            smtp: Server { host: "smtp.ejemplo.es".into(), port: 465, security: Security::Tls },
            protocol: Default::default(),
            auth: Default::default(),
            url: None,
            save_sent: None,
        }
    }

    #[test]
    fn password_never_goes_in_the_file() {
        let dir = temp_dir("pw");
        let store = Accounts::new(&dir);
        let secrets = MemorySecrets::default();
        store.save(acct(), Some("s3creto-único"), &secrets).unwrap();
        let text = fs::read_to_string(dir.join("mail-accounts.json")).unwrap();
        assert!(!text.contains("s3creto"));
        assert_eq!(secrets.get("a1").unwrap().as_deref(), Some("s3creto-único"));
        assert_eq!(store.list().unwrap(), vec![acct()]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_new_account_needs_a_password_and_changing_the_server_needs_it_again() {
        let dir = temp_dir("dest");
        let store = Accounts::new(&dir);
        let secrets = MemorySecrets::default();
        assert!(store.save(acct(), None, &secrets).unwrap_err().contains("contraseña"));
        store.save(acct(), Some("x"), &secrets).unwrap();
        // renaming is fine without a password
        let mut renamed = acct();
        renamed.name = "Trabajo".into();
        store.save(renamed, None, &secrets).unwrap();
        // pointing the account somewhere else is not
        let mut moved = acct();
        moved.imap.host = "imap.malo.example".into();
        assert!(store.save(moved.clone(), None, &secrets).unwrap_err().contains("de nuevo"));
        assert_eq!(store.get("a1").unwrap().imap.host, "imap.ejemplo.es");
        store.save(moved, Some("otra"), &secrets).unwrap();
        assert_eq!(secrets.get("a1").unwrap().as_deref(), Some("otra"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn removing_forgets_the_password_and_invalid_accounts_are_refused() {
        let dir = temp_dir("rm");
        let store = Accounts::new(&dir);
        let secrets = MemorySecrets::default();
        store.save(acct(), Some("x"), &secrets).unwrap();
        store.remove("a1", &secrets).unwrap();
        assert!(store.list().unwrap().is_empty());
        assert_eq!(secrets.get("a1").unwrap(), None);
        let mut bad = acct();
        bad.email = "no".into();
        assert!(store.save(bad, Some("x"), &secrets).is_err());
        assert!(store.save(acct(), Some(""), &secrets).is_err());
        assert!(store.get("nada").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_damaged_list_is_reported_not_overwritten() {
        let dir = temp_dir("bad");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("mail-accounts.json"), "{no es json").unwrap();
        let store = Accounts::new(&dir);
        assert!(store.list().unwrap_err().contains("dañada"));
        assert!(store.save(acct(), Some("x"), &MemorySecrets::default()).is_err());
        assert_eq!(fs::read_to_string(dir.join("mail-accounts.json")).unwrap(), "{no es json");
        let _ = fs::remove_dir_all(&dir);
    }
}
