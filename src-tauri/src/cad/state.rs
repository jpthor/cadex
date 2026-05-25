use std::collections::HashMap;
use std::sync::Mutex;

use cadrum::Solid;
use uuid::Uuid;

use super::types::KernelError;

/// Opaque identifier used to refer to a `Solid` stored in `KernelState`.
/// Handles are short hex strings derived from UUIDs.
pub type KernelHandle = String;

/// In-memory store of CAD solids, keyed by `KernelHandle`. The store lives in
/// a Tauri-managed state (one per app instance) and is never persisted; on
/// project reload the frontend retesselates by re-running the timeline.
#[derive(Default)]
pub struct KernelState {
    inner: Mutex<HashMap<KernelHandle, Solid>>,
}

impl KernelState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    pub fn insert(&self, solid: Solid) -> Result<KernelHandle, KernelError> {
        let mut map = self.inner.lock().map_err(|_| KernelError::Poisoned)?;
        let handle = new_handle();
        map.insert(handle.clone(), solid);
        Ok(handle)
    }

    pub fn replace(
        &self,
        handle: &KernelHandle,
        solid: Solid,
    ) -> Result<(), KernelError> {
        let mut map = self.inner.lock().map_err(|_| KernelError::Poisoned)?;
        if !map.contains_key(handle) {
            return Err(KernelError::UnknownHandle(handle.clone()));
        }
        map.insert(handle.clone(), solid);
        Ok(())
    }

    pub fn remove(&self, handle: &KernelHandle) -> Result<(), KernelError> {
        let mut map = self.inner.lock().map_err(|_| KernelError::Poisoned)?;
        map.remove(handle);
        Ok(())
    }

    pub fn with<F, R>(&self, handle: &KernelHandle, f: F) -> Result<R, KernelError>
    where
        F: FnOnce(&Solid) -> R,
    {
        let map = self.inner.lock().map_err(|_| KernelError::Poisoned)?;
        let solid = map
            .get(handle)
            .ok_or_else(|| KernelError::UnknownHandle(handle.clone()))?;
        Ok(f(solid))
    }

    pub fn clone_solid(&self, handle: &KernelHandle) -> Result<Solid, KernelError> {
        self.with(handle, |solid| solid.clone())
    }

    #[allow(dead_code)]
    pub fn handles(&self) -> Result<Vec<KernelHandle>, KernelError> {
        let map = self.inner.lock().map_err(|_| KernelError::Poisoned)?;
        Ok(map.keys().cloned().collect())
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.inner.lock().map(|m| m.len()).unwrap_or(0)
    }

    #[allow(dead_code)]
    pub fn clear(&self) {
        if let Ok(mut map) = self.inner.lock() {
            map.clear();
        }
    }
}

fn new_handle() -> KernelHandle {
    let uuid = Uuid::new_v4();
    format!("k{}", uuid.simple())
}
