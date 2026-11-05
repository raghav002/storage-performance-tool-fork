import { useMantineTheme } from "@mantine/core";
import { useElementSize, useMergedRef, useReducedMotion } from "@mantine/hooks";
import { useEffect, useMemo, useRef } from "react";
import { createChartTheme, init } from "../charts/echarts";
import type { ChartOption, EChartsType } from "../charts/echarts";

type Props = {
  option: ChartOption;
  label: string;
  className?: string;
  onReady?: (chart: EChartsType) => void | (() => void);
};

export function EChart({ option, label, className, onReady }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const { ref: sizeRef, width, height } = useElementSize<HTMLDivElement>();
  const ref = useMergedRef(element, sizeRef);
  const theme = useMantineTheme();
  const chartTheme = useMemo(() => createChartTheme(theme), [theme]);
  const reducedMotion = useReducedMotion(undefined, {
    getInitialValueInEffect: false,
  });
  const visible = width > 0 && height > 0;

  useEffect(() => {
    if (!element.current || !visible) return;
    const instance = init(element.current, chartTheme, { renderer: "canvas" });
    chart.current = instance;
    return () => {
      instance.dispose();
      chart.current = null;
    };
  }, [chartTheme, visible]);

  useEffect(() => {
    const series = option.series;
    chart.current?.setOption(
      {
        ...option,
        animation: reducedMotion ? false : (option.animation ?? false),
        series:
          reducedMotion && series
            ? Array.isArray(series)
              ? series.map((item) => ({ ...item, animation: false }))
              : { ...series, animation: false }
            : series,
        aria: {
          ...option.aria,
          enabled: true,
          label: { ...option.aria?.label, description: label },
        },
      },
      { replaceMerge: ["series"] },
    );
  }, [option, label, reducedMotion, chartTheme, visible]);

  useEffect(() => {
    chart.current?.resize();
  }, [width, height]);

  useEffect(() => {
    if (chart.current) return onReady?.(chart.current);
  }, [onReady, chartTheme, visible]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className={className ?? "h-[320px] w-full min-w-0"}
    />
  );
}
