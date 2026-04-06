import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { collectDeviceSnapshot, type DeviceSnapshot } from './device-info';

const STORAGE_KEY = '@bg_task_run_log';
const NEXT_EXPECTED_KEY = '@bg_task_next_expected';

export const BACKGROUND_TASK_IDENTIFIER = 'com.momokun.dummyapp.background-task';

export interface TaskLogEntry {
  triggerTime: string;
  expectedTriggerTime: string | null;
  delaySeconds: number | null; // actual - expected, null on first run
  message: string;
  deviceSnapshot: DeviceSnapshot | null;
}

// Shared in-memory log — populated when the task fires while the app is alive
export const taskRunLog: TaskLogEntry[] = [];

// Listeners to notify UI when a new log entry is added
const listeners: Array<() => void> = [];

export function subscribeToTaskLog(cb: () => void) {
  listeners.push(cb);
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

function notifyListeners() {
  listeners.forEach((cb) => cb());
}

const MINIMUM_INTERVAL_MINUTES = 15;

// Must be defined at module (global) scope — not inside a React component
TaskManager.defineTask(BACKGROUND_TASK_IDENTIFIER, async () => {
  try {
    const now = new Date();
    const ts = now.toISOString();

    // Collect device snapshot
    let deviceSnapshot: DeviceSnapshot | null = null;
    try {
      deviceSnapshot = await collectDeviceSnapshot();
    } catch (e) {
      console.warn('[BackgroundTask] failed to collect device snapshot:', e);
    }

    // Read expected trigger time from previous run
    let expectedTriggerTime: string | null = null;
    let delaySeconds: number | null = null;
    try {
      expectedTriggerTime = await AsyncStorage.getItem(NEXT_EXPECTED_KEY);
      if (expectedTriggerTime) {
        const expectedDate = new Date(expectedTriggerTime);
        delaySeconds = Math.round((now.getTime() - expectedDate.getTime()) / 1000);
      }
    } catch (e) {
      console.warn('[BackgroundTask] failed to read expected time:', e);
    }

    const msg = `[BackgroundTask] fired at ${ts}`;
    console.log(msg);

    const entry: TaskLogEntry = {
      triggerTime: ts,
      expectedTriggerTime,
      delaySeconds,
      message: msg,
      deviceSnapshot,
    };

    // Update in-memory log
    taskRunLog.unshift(entry);
    if (taskRunLog.length > 20) taskRunLog.length = 20;

    // Persist so it survives app restarts and production builds
    await appendLogToStorage(entry);

    // Store the next expected trigger time
    const nextExpected = new Date(now.getTime() + MINIMUM_INTERVAL_MINUTES * 60 * 1000);
    await AsyncStorage.setItem(NEXT_EXPECTED_KEY, nextExpected.toISOString());

    notifyListeners();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.error('[BackgroundTask] failed:', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Register the background task with a 15-minute minimum interval (iOS minimum). */
export async function registerBackgroundTask() {
  const result = await BackgroundTask.registerTaskAsync(BACKGROUND_TASK_IDENTIFIER, {
    minimumInterval: MINIMUM_INTERVAL_MINUTES, // minutes — iOS minimum; system may delay further
  });

  // Set initial expected trigger time from registration
  const nextExpected = new Date(Date.now() + MINIMUM_INTERVAL_MINUTES * 60 * 1000);
  await AsyncStorage.setItem(NEXT_EXPECTED_KEY, nextExpected.toISOString());

  return result;
}

export async function unregisterBackgroundTask() {
  await AsyncStorage.removeItem(NEXT_EXPECTED_KEY);
  return BackgroundTask.unregisterTaskAsync(BACKGROUND_TASK_IDENTIFIER);
}

/** Only available in debug/dev builds. Simulates the system triggering the task. */
export async function triggerBackgroundTaskForTesting() {
  return BackgroundTask.triggerTaskWorkerForTestingAsync();
}

// Storage helpers

async function appendLogToStorage(entry: TaskLogEntry) {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const existing: TaskLogEntry[] = raw ? JSON.parse(raw) : [];
  existing.unshift(entry);
  if (existing.length > 50) existing.length = 50;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

/** Load persisted log entries from AsyncStorage. */
export async function loadLogFromStorage(): Promise<TaskLogEntry[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

/** Clear all persisted log entries. */
export async function clearStorageLog() {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/** Clear everything this module has stored in AsyncStorage. */
export async function clearAllStorage() {
  await AsyncStorage.multiRemove([STORAGE_KEY, NEXT_EXPECTED_KEY]);
}

/** Get the next expected trigger time. */
export async function getNextExpectedTriggerTime(): Promise<string | null> {
  return AsyncStorage.getItem(NEXT_EXPECTED_KEY);
}
