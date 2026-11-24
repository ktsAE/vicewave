// A recording belongs to a single station. Blobs stay in this browser.
let connection;
function db() {
  if (!connection)
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open('vicewave-recordings', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('recordings');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  return connection;
}
export async function recording(action, key, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('recordings', ['put', 'add'].includes(action) ? 'readwrite' : 'readonly');
    const store = tx.objectStore('recordings');
    const req =
      action === 'keys'
        ? store.getAllKeys()
        : action === 'put'
          ? store.put(value, key)
          : action === 'add'
            ? store.add(value, key)
            : store.get(key);
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = tx.onerror = () => reject(tx.error || req.error);
  });
}
