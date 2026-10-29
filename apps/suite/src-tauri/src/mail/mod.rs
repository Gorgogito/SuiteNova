//! Conexión de Nova Mail con servidores de correo: IMAP, POP3, JMAP y Exchange (EWS) para leer y gestionar, SMTP o el propio
//! servicio para enviar, y OAuth 2.0 para iniciar sesión sin contraseña.
//!
//! Seguridad: las credenciales solo existen en el almacén seguro del sistema y en la memoria de este proceso; la página
//! nunca las recibe. Las órdenes aceptan solo el identificador de una cuenta ya guardada y usan el servidor guardado con ella.

pub mod account;
pub mod auth;
pub mod backend;
pub mod commands;
pub mod ews_client;
pub mod http;
pub mod imap_client;
pub mod jmap_client;
pub mod pop3_client;
pub mod smtp_client;
pub mod store;
pub mod tls;

#[cfg(test)]
mod fake;
#[cfg(test)]
mod fake_http;
#[cfg(test)]
mod integration;
