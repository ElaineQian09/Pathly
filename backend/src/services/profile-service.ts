import type { UserProfile } from "../models/types.js";
import { FileStore } from "../store/file-store.js";

export class ProfileService {
  constructor(private readonly store: FileStore) {}

  getProfile(): UserProfile | null {
    return this.store.getProfile();
  }

  upsertProfile(profile: UserProfile): UserProfile {
    return this.store.setProfile(profile);
  }
}
