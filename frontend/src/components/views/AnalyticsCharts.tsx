'use client';

import React from 'react';
import styles from './analytics.module.css';

export interface StatItem {
  label: string;
  value: number | string;
}

/** Responsive grid of KPI cards. */
export function StatGrid({ stats }: { stats: StatItem[] }) {
  return (
    <div className={styles.statGrid}>
      {stats.map((s) => (
        <div key={s.label} className={styles.statCard}>
          <span className={styles.statValue}>{s.value}</span>
          <span className={styles.statLabel}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

export interface BarListItem {
  key: string;
  label: string;
  sublabel?: string;
  value: number;
}

/** Horizontal bar list (leaderboards, most-triggered). */
export function BarList({ items, emptyText = 'No data yet.' }: { items: BarListItem[]; emptyText?: string }) {
  if (!items.length) return <div className={styles.empty}>{emptyText}</div>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className={styles.barList}>
      {items.map((item) => (
        <div key={item.key} className={styles.barRow}>
          <div className={styles.barMain}>
            <div className={styles.barName} title={item.label}>
              {item.label}
            </div>
            {item.sublabel && (
              <div className={styles.barSub} title={item.sublabel}>
                {item.sublabel}
              </div>
            )}
          </div>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }} />
          </div>
          <div className={styles.barValue}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export interface TrendPoint {
  day: string;
  runs: number;
}

/** Minimal dependency-free column chart for a daily run trend. */
export function RunTrendBars({ data }: { data: TrendPoint[] }) {
  if (!data.length) return <div className={styles.empty}>No runs in the last 14 days.</div>;
  const max = Math.max(...data.map((d) => d.runs), 1);
  return (
    <div className={styles.chart}>
      {data.map((d) => (
        <div key={d.day} className={styles.chartCol}>
          <div
            className={styles.chartBar}
            style={{ height: `${Math.max((d.runs / max) * 100, 3)}%` }}
            title={`${d.day}: ${d.runs} run${d.runs === 1 ? '' : 's'}`}
          />
          <span className={styles.chartLabel}>{d.day.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export { styles as analyticsStyles };
