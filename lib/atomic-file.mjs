import { rename } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

// Windows scanners can briefly hold the destination. Keep the existing file
// intact and retry the atomic replacement; never fall back to delete + write.
export async function replaceTemporaryFile(
  source,
  destination,
  { renameFile = rename, pause = setTimeout } = {},
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await renameFile(source, destination);
    } catch (error) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt >= 5)
        throw error;
      await pause(20 * 2 ** attempt);
    }
  }
}
