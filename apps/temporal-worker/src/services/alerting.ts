import axios from 'axios';
import { logger } from '../utils/logger';
import { recordSLOViolation } from './metrics';

export interface AlertConfig {
  opsgenieApiKey: string;
  opsgenieApiUrl: string;
  teamName: string;
  escalationPolicy: string;
  mttrThresholdMs: number; // Default: 10 minutes
  proofFailureRateThreshold: number; // Default: 5%
  alertWindowMs: number; // Default: 1 hour
}

export interface AlertCriteria {
  mttrP95Ms: number;
  mttrP99Ms: number;
  proofFailureRate: number;
  diagnosisAccuracy: number;
  patchSuccessRate: number;
  repository: string;
  timeWindowMs: number;
}

export interface Alert {
  id: string;
  type:
    | 'MTTR_VIOLATION'
    | 'PROOF_FAILURE_RATE'
    | 'DIAGNOSIS_ACCURACY'
    | 'PATCH_SUCCESS_RATE';
  severity: 'P1' | 'P2' | 'P3' | 'P4';
  title: string;
  description: string;
  repository: string;
  criteria: AlertCriteria;
  timestamp: string;
  acknowledged: boolean;
  resolved: boolean;
}

export class AlertingService {
  private config: AlertConfig;
  private alerts: Map<string, Alert> = new Map();

  constructor(config: AlertConfig) {
    this.config = config;
  }

  /**
   * Evaluates alert criteria and triggers alerts if thresholds are exceeded
   */
  async evaluateAlerts(criteria: AlertCriteria): Promise<Alert[]> {
    const triggeredAlerts: Alert[] = [];

    // Check MTTR violations
    if (criteria.mttrP95Ms > this.config.mttrThresholdMs) {
      const alert = await this.createMTTRAlert(criteria);
      triggeredAlerts.push(alert);
    }

    // Check proof failure rate
    if (criteria.proofFailureRate > this.config.proofFailureRateThreshold) {
      const alert = await this.createProofFailureAlert(criteria);
      triggeredAlerts.push(alert);
    }

    // Check diagnosis accuracy
    if (criteria.diagnosisAccuracy < 95) {
      const alert = await this.createDiagnosisAccuracyAlert(criteria);
      triggeredAlerts.push(alert);
    }

    // Check patch success rate
    if (criteria.patchSuccessRate < 90) {
      const alert = await this.createPatchSuccessAlert(criteria);
      triggeredAlerts.push(alert);
    }

    return triggeredAlerts;
  }

  /**
   * Creates MTTR violation alert
   */
  private async createMTTRAlert(criteria: AlertCriteria): Promise<Alert> {
    const severity = criteria.mttrP95Ms > 900000 ? 'P1' : 'P2'; // 15min threshold for P1

    const alert: Alert = {
      id: `mttr-${criteria.repository}-${Date.now()}`,
      type: 'MTTR_VIOLATION',
      severity,
      title: `MTTR Violation: ${criteria.repository}`,
      description: `Mean Time To Recovery exceeded threshold. P95: ${criteria.mttrP95Ms}ms, P99: ${criteria.mttrP99Ms}ms. Threshold: ${this.config.mttrThresholdMs}ms`,
      repository: criteria.repository,
      criteria,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      resolved: false,
    };

    await this.sendOpsgenieAlert(alert);
    this.alerts.set(alert.id, alert);

    // Record SLO violation
    recordSLOViolation(
      'mttr',
      criteria.repository,
      severity.toLowerCase() as any
    );

    logger.warn('MTTR violation alert created', {
      alertId: alert.id,
      repository: criteria.repository,
      mttrP95Ms: criteria.mttrP95Ms,
      mttrP99Ms: criteria.mttrP99Ms,
      severity,
    });

    return alert;
  }

  /**
   * Creates proof failure rate alert
   */
  private async createProofFailureAlert(
    criteria: AlertCriteria
  ): Promise<Alert> {
    const severity = criteria.proofFailureRate > 10 ? 'P1' : 'P2'; // 10% threshold for P1

    const alert: Alert = {
      id: `proof-failure-${criteria.repository}-${Date.now()}`,
      type: 'PROOF_FAILURE_RATE',
      severity,
      title: `Proof Failure Rate Alert: ${criteria.repository}`,
      description: `Proof validation failure rate exceeded threshold. Current: ${criteria.proofFailureRate}%, Threshold: ${this.config.proofFailureRateThreshold}%`,
      repository: criteria.repository,
      criteria,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      resolved: false,
    };

    await this.sendOpsgenieAlert(alert);
    this.alerts.set(alert.id, alert);

    // Record SLO violation
    recordSLOViolation(
      'proof_failure_rate',
      criteria.repository,
      severity.toLowerCase() as any
    );

    logger.warn('Proof failure rate alert created', {
      alertId: alert.id,
      repository: criteria.repository,
      failureRate: criteria.proofFailureRate,
      threshold: this.config.proofFailureRateThreshold,
      severity,
    });

    return alert;
  }

  /**
   * Creates diagnosis accuracy alert
   */
  private async createDiagnosisAccuracyAlert(
    criteria: AlertCriteria
  ): Promise<Alert> {
    const severity = criteria.diagnosisAccuracy < 90 ? 'P1' : 'P2'; // 90% threshold for P1

    const alert: Alert = {
      id: `diagnosis-accuracy-${criteria.repository}-${Date.now()}`,
      type: 'DIAGNOSIS_ACCURACY',
      severity,
      title: `Diagnosis Accuracy Alert: ${criteria.repository}`,
      description: `Diagnosis accuracy below threshold. Current: ${criteria.diagnosisAccuracy}%, Target: 95%`,
      repository: criteria.repository,
      criteria,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      resolved: false,
    };

    await this.sendOpsgenieAlert(alert);
    this.alerts.set(alert.id, alert);

    // Record SLO violation
    recordSLOViolation(
      'diagnosis_accuracy',
      criteria.repository,
      severity.toLowerCase() as any
    );

    logger.warn('Diagnosis accuracy alert created', {
      alertId: alert.id,
      repository: criteria.repository,
      accuracy: criteria.diagnosisAccuracy,
      target: 95,
      severity,
    });

    return alert;
  }

  /**
   * Creates patch success rate alert
   */
  private async createPatchSuccessAlert(
    criteria: AlertCriteria
  ): Promise<Alert> {
    const severity = criteria.patchSuccessRate < 80 ? 'P1' : 'P2'; // 80% threshold for P1

    const alert: Alert = {
      id: `patch-success-${criteria.repository}-${Date.now()}`,
      type: 'PATCH_SUCCESS_RATE',
      severity,
      title: `Patch Success Rate Alert: ${criteria.repository}`,
      description: `Patch application success rate below threshold. Current: ${criteria.patchSuccessRate}%, Target: 90%`,
      repository: criteria.repository,
      criteria,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      resolved: false,
    };

    await this.sendOpsgenieAlert(alert);
    this.alerts.set(alert.id, alert);

    // Record SLO violation
    recordSLOViolation(
      'patch_success_rate',
      criteria.repository,
      severity.toLowerCase() as any
    );

    logger.warn('Patch success rate alert created', {
      alertId: alert.id,
      repository: criteria.repository,
      successRate: criteria.patchSuccessRate,
      target: 90,
      severity,
    });

    return alert;
  }

  /**
   * Sends alert to Opsgenie
   */
  private async sendOpsgenieAlert(alert: Alert): Promise<void> {
    try {
      const opsgeniePayload = {
        message: alert.title,
        description: alert.description,
        alias: alert.id,
        priority: alert.severity,
        tags: ['self-healing-ci', alert.type, alert.repository],
        details: {
          repository: alert.repository,
          alertType: alert.type,
          severity: alert.severity,
          timestamp: alert.timestamp,
          criteria: JSON.stringify(alert.criteria),
        },
        entity: `self-healing-ci-${alert.repository}`,
        source: 'Self-Healing CI System',
        team: this.config.teamName,
        responders: [
          {
            type: 'team',
            name: this.config.teamName,
          },
        ],
        visibleTo: [
          {
            type: 'team',
            name: this.config.teamName,
          },
        ],
        actions: ['acknowledge', 'resolve'],
        customProperties: {
          'alert-id': alert.id,
          repository: alert.repository,
          'alert-type': alert.type,
          severity: alert.severity,
        },
      };

      const response = await axios.post(
        `${this.config.opsgenieApiUrl}/v2/alerts`,
        opsgeniePayload,
        {
          headers: {
            Authorization: `GenieKey ${this.config.opsgenieApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      logger.info('Alert sent to Opsgenie successfully', {
        alertId: alert.id,
        opsgenieId: response.data.data.id,
        repository: alert.repository,
        type: alert.type,
        severity: alert.severity,
      });
    } catch (error) {
      logger.error('Failed to send alert to Opsgenie', {
        alertId: alert.id,
        repository: alert.repository,
        error: error instanceof Error ? error.message : String(error),
      });

      // Don't throw - we don't want alerting failures to break the system
    }
  }

  /**
   * Acknowledges an alert
   */
  async acknowledgeAlert(alertId: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    alert.acknowledged = true;
    alert.timestamp = new Date().toISOString();

    try {
      await axios.post(
        `${this.config.opsgenieApiUrl}/v2/alerts/${alertId}/acknowledge`,
        {},
        {
          headers: {
            Authorization: `GenieKey ${this.config.opsgenieApiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info('Alert acknowledged', {
        alertId,
        repository: alert.repository,
        type: alert.type,
      });
    } catch (error) {
      logger.error('Failed to acknowledge alert in Opsgenie', {
        alertId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Resolves an alert
   */
  async resolveAlert(alertId: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    alert.resolved = true;
    alert.timestamp = new Date().toISOString();

    try {
      await axios.post(
        `${this.config.opsgenieApiUrl}/v2/alerts/${alertId}/close`,
        {
          note: 'Alert resolved by Self-Healing CI system',
        },
        {
          headers: {
            Authorization: `GenieKey ${this.config.opsgenieApiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info('Alert resolved', {
        alertId,
        repository: alert.repository,
        type: alert.type,
      });
    } catch (error) {
      logger.error('Failed to resolve alert in Opsgenie', {
        alertId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Gets all active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values()).filter(alert => !alert.resolved);
  }

  /**
   * Gets alerts for a specific repository
   */
  getAlertsByRepository(repository: string): Alert[] {
    return Array.from(this.alerts.values()).filter(
      alert => alert.repository === repository && !alert.resolved
    );
  }

  /**
   * Gets alerts by type
   */
  getAlertsByType(type: Alert['type']): Alert[] {
    return Array.from(this.alerts.values()).filter(
      alert => alert.type === type && !alert.resolved
    );
  }

  /**
   * Cleans up old resolved alerts
   */
  cleanupOldAlerts(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): void {
    // 7 days
    const cutoffTime = Date.now() - maxAgeMs;

    for (const [alertId, alert] of this.alerts.entries()) {
      if (alert.resolved && new Date(alert.timestamp).getTime() < cutoffTime) {
        this.alerts.delete(alertId);
        logger.info('Cleaned up old resolved alert', {
          alertId,
          repository: alert.repository,
          type: alert.type,
          age: Date.now() - new Date(alert.timestamp).getTime(),
        });
      }
    }
  }

  /**
   * Gets alert statistics
   */
  getAlertStatistics(): {
    total: number;
    active: number;
    acknowledged: number;
    resolved: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  } {
    const alerts = Array.from(this.alerts.values());

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    alerts.forEach(alert => {
      byType[alert.type] = (byType[alert.type] || 0) + 1;
      bySeverity[alert.severity] = (bySeverity[alert.severity] || 0) + 1;
    });

    return {
      total: alerts.length,
      active: alerts.filter(a => !a.resolved).length,
      acknowledged: alerts.filter(a => a.acknowledged && !a.resolved).length,
      resolved: alerts.filter(a => a.resolved).length,
      byType,
      bySeverity,
    };
  }
}

/**
 * Creates a default alerting service configuration
 */
export function createDefaultAlertingConfig(): AlertConfig {
  return {
    opsgenieApiKey: process.env['OPSGENIE_API_KEY'] || '',
    opsgenieApiUrl:
      process.env['OPSGENIE_API_URL'] || 'https://api.opsgenie.com',
    teamName: process.env['OPSGENIE_TEAM_NAME'] || 'Self-Healing-CI',
    escalationPolicy: process.env['OPSGENIE_ESCALATION_POLICY'] || 'default',
    mttrThresholdMs: parseInt(process.env['MTTR_THRESHOLD_MS'] || '600000'), // 10 minutes
    proofFailureRateThreshold: parseFloat(
      process.env['PROOF_FAILURE_RATE_THRESHOLD'] || '5'
    ), // 5%
    alertWindowMs: parseInt(process.env['ALERT_WINDOW_MS'] || '3600000'), // 1 hour
  };
}
