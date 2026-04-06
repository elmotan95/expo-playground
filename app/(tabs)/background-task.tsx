import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  BACKGROUND_TASK_IDENTIFIER,
  clearAllStorage,
  clearStorageLog,
  getNextExpectedTriggerTime,
  loadLogFromStorage,
  registerBackgroundTask,
  subscribeToTaskLog,
  taskRunLog,
  triggerBackgroundTaskForTesting,
  unregisterBackgroundTask,
  type TaskLogEntry,
} from '@/app/lib/background-task';

function formatDelay(seconds: number | null): string {
  if (seconds === null) return 'N/A (first run)';
  if (seconds < 0) return `${Math.abs(seconds)}s early`;
  if (seconds < 60) return `${seconds}s late`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s late`;
}

function formatBatteryLevel(level: number): string {
  return `${Math.round(level * 100)}%`;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'N/A';
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function LogEntry({ entry }: { entry: TaskLogEntry }) {
  const snapshot = entry.deviceSnapshot;

  // Backward compat: old entries only have timestamp+message
  if (!snapshot && !entry.triggerTime) {
    const legacy = entry as any;
    return (
      <View style={styles.logEntry}>
        <Text style={styles.logTimestamp}>{legacy.timestamp}</Text>
        <Text style={styles.logMessage}>{legacy.message}</Text>
      </View>
    );
  }

  return (
    <View style={styles.logEntry}>
      {/* Timing */}
      <View style={styles.logRow}>
        <Text style={styles.logLabel}>Triggered</Text>
        <Text style={styles.logValue}>{formatDateTime(entry.triggerTime)}</Text>
      </View>
      {entry.expectedTriggerTime && (
        <View style={styles.logRow}>
          <Text style={styles.logLabel}>Expected</Text>
          <Text style={styles.logValue}>{formatTime(entry.expectedTriggerTime)}</Text>
        </View>
      )}
      <View style={styles.logRow}>
        <Text style={styles.logLabel}>Delay</Text>
        <Text style={[styles.logValue, entry.delaySeconds !== null && entry.delaySeconds > 300 && styles.logValueWarn]}>
          {formatDelay(entry.delaySeconds)}
        </Text>
      </View>

      {snapshot && (
        <>
          <View style={styles.logDivider} />

          {/* Battery */}
          <View style={styles.logRow}>
            <Text style={styles.logLabel}>Battery</Text>
            <Text style={[
              styles.logValue,
              snapshot.battery.level < 0.2 && styles.logValueWarn,
            ]}>
              {formatBatteryLevel(snapshot.battery.level)} ({snapshot.battery.state})
            </Text>
          </View>
          {snapshot.battery.lowPowerMode && (
            <View style={styles.logRow}>
              <Text style={styles.logLabel}>Low Power</Text>
              <Text style={[styles.logValue, styles.logValueWarn]}>Yes</Text>
            </View>
          )}

          {/* Network */}
          <View style={styles.logRow}>
            <Text style={styles.logLabel}>Network</Text>
            <Text style={styles.logValue}>
              {snapshot.network.type}
              {snapshot.network.cellularGeneration ? ` (${snapshot.network.cellularGeneration})` : ''}
            </Text>
          </View>
          <View style={styles.logRow}>
            <Text style={styles.logLabel}>Connected</Text>
            <Text style={[
              styles.logValue,
              !snapshot.network.isConnected && styles.logValueWarn,
            ]}>
              {snapshot.network.isConnected ? 'Yes' : 'No'}
              {snapshot.network.isInternetReachable === false ? ' (no internet)' : ''}
            </Text>
          </View>

          {/* Device */}
          <View style={styles.logDivider} />
          <View style={styles.logRow}>
            <Text style={styles.logLabel}>Device</Text>
            <Text style={styles.logValue}>{snapshot.device.modelName ?? 'N/A'}</Text>
          </View>
          <View style={styles.logRow}>
            <Text style={styles.logLabel}>iOS</Text>
            <Text style={styles.logValue}>{snapshot.device.osVersion ?? 'N/A'}</Text>
          </View>
          <View style={styles.logRow}>
            <Text style={styles.logLabel}>RAM</Text>
            <Text style={styles.logValue}>{formatBytes(snapshot.device.totalMemory)}</Text>
          </View>
        </>
      )}
    </View>
  );
}

export default function BackgroundTaskScreen() {
  const [status, setStatus] = useState<BackgroundTask.BackgroundTaskStatus | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [log, setLog] = useState<TaskLogEntry[]>([]);
  const [persistedLog, setPersistedLog] = useState<TaskLogEntry[]>([]);
  const [nextExpected, setNextExpected] = useState<string | null>(null);

  useEffect(() => {
    refresh();

    const unsub = subscribeToTaskLog(() => {
      setLog([...taskRunLog]);
      refreshNextExpected();
    });

    return unsub;
  }, []);

  const refreshNextExpected = async () => {
    const next = await getNextExpectedTriggerTime();
    setNextExpected(next);
  };

  const refresh = async () => {
    const s = await BackgroundTask.getStatusAsync();
    setStatus(s);
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_IDENTIFIER);
    setIsRegistered(registered);
    setLog([...taskRunLog]);
    const stored = await loadLogFromStorage();
    setPersistedLog(stored);
    await refreshNextExpected();
  };

  const handleClearStorage = async () => {
    await clearStorageLog();
    setPersistedLog([]);
  };

  const handleClearAll = async () => {
    Alert.alert(
      'Clear All AsyncStorage',
      'This will remove all persisted logs and the next expected trigger time. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            await clearAllStorage();
            taskRunLog.length = 0;
            setLog([]);
            setPersistedLog([]);
            setNextExpected(null);
          },
        },
      ],
    );
  };

  const handleToggle = async () => {
    try {
      if (isRegistered) {
        await unregisterBackgroundTask();
      } else {
        await registerBackgroundTask();
      }
      await refresh();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handleTrigger = async () => {
    try {
      await triggerBackgroundTaskForTesting();
      await new Promise((r) => setTimeout(r, 500));
      await refresh();
    } catch (e: any) {
      Alert.alert('Trigger failed', e.message);
    }
  };

  const statusLabel =
    status === BackgroundTask.BackgroundTaskStatus.Available
      ? 'Available'
      : status === BackgroundTask.BackgroundTaskStatus.Restricted
        ? 'Restricted'
        : '--';

  const isIOS = Platform.OS === 'ios';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Background Task</Text>

      <View style={styles.card}>
        <Row label="Platform" value={Platform.OS} />
        <Row label="API Status" value={statusLabel} />
        <Row label="Registered" value={isRegistered ? 'Yes' : 'No'} />
        <Row label="Identifier" value={BACKGROUND_TASK_IDENTIFIER} small />
        <Row label="Min interval" value="15 min (iOS minimum)" />
        {nextExpected && (
          <Row label="Next expected" value={formatDateTime(nextExpected)} />
        )}
      </View>

      {!isIOS && (
        <Text style={styles.warning}>This screen is intended for iOS only.</Text>
      )}

      <TouchableOpacity
        style={[styles.button, isRegistered ? styles.buttonDanger : styles.buttonPrimary]}
        onPress={handleToggle}
        disabled={status === BackgroundTask.BackgroundTaskStatus.Restricted}>
        <Text style={styles.buttonText}>
          {isRegistered ? 'Unregister Task' : 'Register Task'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.buttonSecondary]}
        onPress={handleTrigger}
        disabled={!isRegistered}>
        <Text style={styles.buttonText}>Trigger Now (dev only)</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.buttonGhost]} onPress={refresh}>
        <Text style={styles.buttonText}>Refresh Status</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.buttonClearAll]} onPress={handleClearAll}>
        <Text style={styles.buttonClearAllText}>Clear All AsyncStorage</Text>
      </TouchableOpacity>

      <View style={styles.logSection}>
        <View style={styles.logTitleRow}>
          <Text style={styles.logTitle}>Run Log (in-memory, this session)</Text>
        </View>
        {log.length === 0 ? (
          <Text style={styles.logEmpty}>No runs recorded yet.</Text>
        ) : (
          log.map((entry, i) => <LogEntry key={i} entry={entry} />)
        )}
      </View>

      <View style={styles.logSection}>
        <View style={styles.logTitleRow}>
          <Text style={styles.logTitle}>Persisted Log (AsyncStorage)</Text>
          <TouchableOpacity onPress={handleClearStorage}>
            <Text style={styles.clearButton}>Clear</Text>
          </TouchableOpacity>
        </View>
        {persistedLog.length === 0 ? (
          <Text style={styles.logEmpty}>Nothing stored yet.</Text>
        ) : (
          persistedLog.map((entry, i) => <LogEntry key={i} entry={entry} />)
        )}
      </View>
    </ScrollView>
  );
}

function Row({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, small && styles.rowValueSmall]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#0f0f0f',
    minHeight: '100%',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 20,
    color: '#f5f5f5',
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2a2a',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a2a',
  },
  rowLabel: {
    color: '#888',
    fontSize: 13,
    flex: 1,
  },
  rowValue: {
    fontWeight: '600',
    fontSize: 13,
    flex: 2,
    textAlign: 'right',
    color: '#e0e0e0',
  },
  rowValueSmall: {
    fontSize: 10,
    color: '#666',
  },
  warning: {
    color: '#fbbf24',
    backgroundColor: '#1c1a00',
    padding: 10,
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3d3500',
  },
  button: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonPrimary: { backgroundColor: '#2563eb' },
  buttonDanger: { backgroundColor: '#dc2626' },
  buttonSecondary: { backgroundColor: '#7c3aed' },
  buttonGhost: { backgroundColor: '#252525' },
  buttonClearAll: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#dc2626',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  buttonClearAllText: {
    color: '#dc2626',
    fontWeight: '600',
    fontSize: 15,
  },
  logSection: {
    marginTop: 20,
  },
  logTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#aaa',
  },
  logEmpty: {
    color: '#555',
    fontStyle: 'italic',
    fontSize: 13,
  },
  logTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  clearButton: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
  logEntry: {
    backgroundColor: '#161616',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2a2a',
  },
  logRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  logLabel: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'monospace',
    flex: 1,
  },
  logValue: {
    color: '#ccc',
    fontSize: 11,
    fontFamily: 'monospace',
    flex: 2,
    textAlign: 'right',
  },
  logValueWarn: {
    color: '#fbbf24',
  },
  logDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#2a2a2a',
    marginVertical: 4,
  },
  logTimestamp: {
    color: '#6ee7b7',
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  logMessage: {
    color: '#ccc',
    fontSize: 12,
    fontFamily: 'monospace',
  },
});
