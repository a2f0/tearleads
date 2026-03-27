import { BrowserWindow } from "electrobun/bun";

new BrowserWindow({
  title: "Tearleads",
  url: "views://mainview/index.html",
  frame: {
    x: 0,
    y: 0,
    width: 1200,
    height: 800,
  },
});
