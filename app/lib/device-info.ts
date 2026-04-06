import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
import NetInfo from '@react-native-community/netinfo';

export interface DeviceSnapshot {
  battery: {
    level: number; // 0.0 – 1.0
    state: string; // 'charging' | 'unplugged' | 'full' | 'unknown'
    lowPowerMode: boolean;
  };
  network: {
    type: string; // 'wifi' | 'cellular' | 'none' | 'unknown' | etc.
    isConnected: boolean;
    isInternetReachable: boolean | null;
    isWifi: boolean;
    cellularGeneration: string | null; // '2g' | '3g' | '4g' | '5g'
  };
  device: {
    modelName: string | null; // e.g. "iPhone 15 Pro"
    osVersion: string | null;
    totalMemory: number | null; // bytes
  };
}

const BATTERY_STATE_MAP: Record<Battery.BatteryState, string> = {
  [Battery.BatteryState.CHARGING]: 'charging',
  [Battery.BatteryState.FULL]: 'full',
  [Battery.BatteryState.UNPLUGGED]: 'unplugged',
  [Battery.BatteryState.UNKNOWN]: 'unknown',
};

export async function collectDeviceSnapshot(): Promise<DeviceSnapshot> {
  const [batteryLevel, batteryState, lowPowerMode, netState] = await Promise.all([
    Battery.getBatteryLevelAsync(),
    Battery.getBatteryStateAsync(),
    Battery.isLowPowerModeEnabledAsync(),
    NetInfo.fetch(),
  ]);

  return {
    battery: {
      level: Math.round(batteryLevel * 100) / 100,
      state: BATTERY_STATE_MAP[batteryState] ?? 'unknown',
      lowPowerMode,
    },
    network: {
      type: netState.type,
      isConnected: netState.isConnected ?? false,
      isInternetReachable: netState.isInternetReachable,
      isWifi: netState.type === 'wifi',
      cellularGeneration:
        netState.type === 'cellular'
          ? (netState.details?.cellularGeneration ?? null)
          : null,
    },
    device: {
      modelName: Device.modelName,
      osVersion: Device.osVersion,
      totalMemory: Device.totalMemory,
    },
  };
}
