export type DrinkType = { id: number; label: string; icon: string; position: number; archived: boolean };
export type Volume = { id: number; ml: number; label: string; icon: string; position: number };
export type DrinkLog = { id: number; atMs: number; ml: number; typeId: number };
export type Snapshot = {
  settings: {
    dailyGoalMl: number;
    reminders: {
      enabled: boolean;
      intervalMinutes: number;
      activeFrom: string;
      activeTo: string;
      pauseWhenGoalMet: boolean;
    };
    lastVolumeId: number | null;
    lastTypeId: number | null;
  };
  types: DrinkType[];
  volumes: Volume[];
  todayLogs: DrinkLog[];
};
