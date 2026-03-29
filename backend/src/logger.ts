type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

type LogFields = Record<string, unknown>;

export const fingerprintSecret = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  if (value.length <= 10) {
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

const verboseDiagnosticsEnabled = (() => {
  const value = process.env.PATHLY_VERBOSE_DIAGNOSTICS?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
})();

const writeLog = (level: LogLevel, event: string, fields: LogFields = {}) => {
  if (level === "DEBUG" && !verboseDiagnosticsEnabled) {
    return;
  }
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
  debug(event: string, fields?: LogFields) {
    writeLog("DEBUG", event, fields);
  },
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
