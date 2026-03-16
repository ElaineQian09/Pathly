type LogLevel = "INFO" | "WARN" | "ERROR";

type LogFields = Record<string, unknown>;

const writeLog = (level: LogLevel, event: string, fields: LogFields = {}) => {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields
  };
  const line = JSON.stringify(payload);
  if (level === "ERROR") {
    console.error(line);
    return;
  }
  console.log(line);
};

export const logger = {
  info(event: string, fields?: LogFields) {
    writeLog("INFO", event, fields);
  },
  warn(event: string, fields?: LogFields) {
    writeLog("WARN", event, fields);
  },
  error(event: string, fields?: LogFields) {
    writeLog("ERROR", event, fields);
  }
};
