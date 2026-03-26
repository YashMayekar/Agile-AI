/**
 * Centralized structured logging system.
 * Uses winston for logging with different formats for console and file.
 * All system components must log through this.
 */

import winston from "winston";

// Custom timestamp format for console (HH:MM:SS)
const consoleTimestampFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  console.log(`${timestamp} ${level.toUpperCase()}`);
    let logMessage = `${message}`;
    // If there's metadata (like event objects), format it nicely
  if (Object.keys(metadata).length > 0) {
    // Remove internal winston properties
    const cleanMetadata = { ...metadata };
    delete cleanMetadata.level;
    delete cleanMetadata.message;
    delete cleanMetadata.timestamp;
    if (Object.keys(cleanMetadata).length > 0) {
      logMessage += ` ${JSON.stringify(cleanMetadata)}`;
    }
  }
  
  return `${timestamp} ${level} ${logMessage}\n`;
});

export const logger = winston.createLogger({
  level: "debug",
  transports: [
    // File transport - JSON format for structured logging
    new winston.transports.File({ 
      filename: "/system.log",
      level: "info",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    
    // Console transport - Human readable format
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        consoleTimestampFormat
      )
    })
  ]
});

/**
 * Helper to log structured events.
 * For console, it shows as readable text.
 * For file, it's stored as JSON.
 */
export function logEvent(event: string, data?: any) {
  const logData = {
    event,
    ...data
  };
  
  // Create a readable message for console
  const consoleMessage = `${event}${data ? ` ${JSON.stringify(data)}` : ''}`;
  
  // For file logging, use the structured format
//   logger.info(consoleMessage, logData);  
}