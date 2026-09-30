import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { h } from "vue";
import ReadingProgress from "./ReadingProgress.vue";
import "./styles.css";

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "layout-top": () => h(ReadingProgress),
    }),
} satisfies Theme;
