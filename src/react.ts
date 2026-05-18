import * as React from "react";
import { Chart } from "./ui/Chart.js";
import type { ChartOptions } from "./ui/Chart.js";

export interface BlazeChartProps {
  readonly options?: ChartOptions;
  readonly className?: string;
  readonly style?: React.CSSProperties;
  readonly chartRef?: React.Ref<Chart | null>;
  readonly onChart?: (chart: Chart) => void;
}

function setRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
  } else {
    (ref as { current: T | null }).current = value;
  }
}

export const BlazeChart = React.forwardRef<Chart | null, BlazeChartProps>(function BlazeChart(props, forwardedRef) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<Chart | null>(null);

  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = new Chart(host, props.options);
    chartRef.current = chart;
    setRef(forwardedRef, chart);
    setRef(props.chartRef, chart);
    props.onChart?.(chart);

    return () => {
      chart.dispose();
      chartRef.current = null;
      setRef(forwardedRef, null);
      setRef(props.chartRef, null);
    };
  }, [props.options]);

  React.useEffect(() => {
    chartRef.current?.resize();
  });

  return React.createElement("div", {
    ref: hostRef,
    className: props.className,
    style: props.style ?? { width: "100%", height: "100%" },
  });
});

export default BlazeChart;
