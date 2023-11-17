import { createContext } from "react";
import StateStore, { IStateStore } from "./DocumentModel";
import { dialog, fs, invoke } from "@tauri-apps/api";
import { v4 as uuidv4 } from "uuid";
import { VERSIONS, validate, SAVE_FILE_VERSION } from "./DocumentSpecTypes";
import { applySnapshot, getRoot, onPatch } from "mobx-state-tree";
import { autorun, reaction, toJS } from "mobx";
import { window, path } from "@tauri-apps/api";
import { TauriEvent } from "@tauri-apps/api/event";
import { IHolonomicPathStore } from "./HolonomicPathStore";
import { toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.min.css";
import hotkeys from "hotkeys-js";

export class DocumentManager {
  undo() {
    this.model.document.history.canUndo && this.model.document.history.undo();
  }
  redo() {
    this.model.document.history.canRedo && this.model.document.history.redo();
  }
  get history() {
    console.log(toJS(this.model.document.history.history));
    return this.model.document.history;
  }
  model: IStateStore;
  constructor() {
    this.model = StateStore.create({
      uiState: {
        selectedSidebarItem: undefined,
        layers: [true, false, true, true],
      },
      document: {
        robotConfig: { identifier: uuidv4() },
        pathlist: {},
        isRobotProject: false,
        projectRoot: "",
      },
    });
    // window.getCurrent().listen(TauriEvent.WINDOW_CLOSE_REQUESTED, async () => {
    //   if (this.model.uiState.saveFileName !== "") {
    //     await this.saveFile();
    //   } else {
    //     if (
    //       await dialog.ask("Save project?", {
    //         title: "Choreo",
    //         type: "warning",
    //       })
    //     ) {
    //       await this.saveFile();
    //     }
    //   }
    //   await window.getCurrent().close();
    // });
    //this.loadPriorFile();
    this.newFile();
    //this.model.uiState.setSaveFileName("");
    reaction(
      () => this.model.document.history.undoIdx,
      () => {
        if (this.model.uiState.saveFileName !== "") {
          this.saveFile();
          console.log("saved");
        }
      }
    );

    this.bindHotkeys();
  }

  async loadPriorFile() {
    var saveFileFromStorage = localStorage.getItem("saveFileName");
    invoke("expand_fs_scope", {path: saveFileFromStorage, isFile: true});
    if (
      saveFileFromStorage !== null &&
      saveFileFromStorage !== "" &&
      (await fs.exists(saveFileFromStorage))
    ) {
      console.log(saveFileFromStorage);
      this.openFile(saveFileFromStorage);
    } else {
      this.newFile();
    }
    this.model.document.pathlist.addPath("NewPath");
    this.model.document.history.clear();
  }

  private bindHotkeys() {
    hotkeys("command+g,ctrl+g,g", () => {
      this.model.generatePath(this.model.document.pathlist.activePathUUID);
    });
    hotkeys("command+z,ctrl+z", () => {
      this.undo();
    });
    hotkeys("command+shift+z,ctrl+shift+z,ctrl+y", () => {
      this.redo();
    });
    hotkeys("command+n,ctrl+n", { keydown: true }, () => {
      this.newFile();
    });
    hotkeys("right,x", () => {
      const waypoints = this.model.document.pathlist.activePath.waypoints;
      const selected = waypoints.find((w) => {
        return w.selected;
      });
      let i = waypoints.indexOf(selected ?? waypoints[0]);
      i++;
      if (i >= waypoints.length) {
        i = waypoints.length - 1;
      }
      this.model.select(waypoints[i]);
    });
    hotkeys("left,z", () => {
      const waypoints = this.model.document.pathlist.activePath.waypoints;
      const selected = waypoints.find((w) => {
        return w.selected;
      });
      let i = waypoints.indexOf(selected ?? waypoints[0]);
      i--;
      if (i <= 0) {
        i = 0;
      }
      this.model.select(waypoints[i]);
    });
    // navbar keys
    for (let i = 0; i < 9; i++) {
      hotkeys((i + 1).toString(), () => {
        this.model.uiState.setSelectedNavbarItem(i);
      });
    }
    // set current waypoint type
    for (let i = 0; i < 4; i++) {
      hotkeys("shift+" + (i + 1), () => {
        const selected = this.getSelectedWaypoint();
        selected?.setType(i);
      });
    }
    // nudge selected waypoint
    hotkeys("d,shift+d", () => {
      const selected = this.getSelectedWaypoint();
      if (selected !== undefined) {
        const delta = hotkeys.shift ? 0.5 : 0.1;
        selected.setX(selected.x + delta);
      }
    });
    hotkeys("a,shift+a", () => {
      const selected = this.getSelectedWaypoint();
      if (selected !== undefined) {
        const delta = hotkeys.shift ? 0.5 : 0.1;
        selected.setX(selected.x - delta);
      }
    });
    hotkeys("w,shift+w", () => {
      const selected = this.getSelectedWaypoint();
      if (selected !== undefined) {
        const delta = hotkeys.shift ? 0.5 : 0.1;
        selected.setY(selected.y + delta);
      }
    });
    hotkeys("s,shift+s", () => {
      const selected = this.getSelectedWaypoint();
      if (selected !== undefined) {
        const delta = hotkeys.shift ? 0.5 : 0.1;
        selected.setY(selected.y - delta);
      }
    });
    hotkeys("q,shift+q", () => {
      const selected = this.getSelectedWaypoint();
      if (selected !== undefined) {
        const delta = hotkeys.shift ? Math.PI / 4 : Math.PI / 16;
        let newHeading = selected.heading + delta;
        selected.setHeading(newHeading);
      }
    });
    hotkeys("e,shift+e", () => {
      const selected = this.getSelectedWaypoint();
      if (selected !== undefined) {
        const delta = hotkeys.shift ? -Math.PI / 4 : -Math.PI / 16;
        let newHeading = selected.heading + delta;
        selected.setHeading(newHeading);
      }
    });
    hotkeys("f", () => {
      const selected = this.getSelectedWaypoint();
      if (selected) {
        const newWaypoint =
          this.model.document.pathlist.activePath.addWaypoint();
        newWaypoint.setX(selected.x);
        newWaypoint.setY(selected.y);
        newWaypoint.setHeading(selected.heading);
        this.model.select(newWaypoint);
      } else {
        const newWaypoint =
          this.model.document.pathlist.activePath.addWaypoint();
        newWaypoint.setX(5);
        newWaypoint.setY(5);
        newWaypoint.setHeading(0);
        this.model.select(newWaypoint);
      }
    });
    hotkeys("delete,backspace,clear", () => {
      const selected = this.getSelectedWaypoint();
      if (selected) {
        this.model.document.pathlist.activePath.deleteWaypointUUID(
          selected.uuid
        );
      }
    });
  }

  private getSelectedWaypoint() {
    const waypoints = this.model.document.pathlist.activePath.waypoints;
    return waypoints.find((w) => {
      return w.selected;
    });
  }
  newFile(): void {
    applySnapshot(this.model, {
      uiState: {
        selectedSidebarItem: undefined,
        layers: [true, false, true, true],
      },
      document: {
        robotConfig: { identifier: uuidv4() },
        pathlist: {},
        isRobotProject: false,
        projectRoot: "",
        trajDir: "",
      },
    });
    this.model.uiState.setSaveFileName("");
    this.model.document.pathlist.addPath("NewPath");
    this.model.document.history.clear();
  }

  async selectBuildGradle() {
    var filepath = await dialog.open({
      title: "Select your project's build.gradle",
      filters: [
        {
          name: "Gradle File",
          extensions: ["gradle"],
        },
      ],
    });
    if (Array.isArray(filepath)) {
      // user selected multiple files
    } else if (filepath === null) {
      // user cancelled the selection
    } else {
      // user selected a single file
      console.log(filepath);

      var projectRoot = await path.dirname(filepath);
      var projectName = await path.basename(projectRoot);
      var chorFilePath = await path.join(projectRoot, `${projectName}.chor`);
      var trajdir = await path.join(
        projectRoot,
        "src",
        "main",
        "deploy",
        "choreo"
      );
      await invoke("expand_fs_scope", { path: projectRoot, isFile: false });
      if (await fs.exists(chorFilePath)) {
        let overwriteFile = await dialog.confirm("This project already has a Choreo file. Overwrite that file?");
        if (!overwriteFile) {
          return;
        }
      }
      // save the chor file
      this.model.uiState.setSaveFileName(chorFilePath);
      this.model.document.setIsRobotProject(true);
      this.model.document.setProjectRoot(projectRoot);
      
      await this.saveFile();
      await this.openFile(chorFilePath);
      console.log(this.model.document.pathlist.paths);
      for (let uuid of this.model.document.pathlist.paths.keys()) {
        console.log(uuid);
        var trajpath = await path.join(
          trajdir,
          `${this.model.document.pathlist.paths.get(uuid)?.name}.traj`
        );
        await this.exportTrajectory(uuid, trajpath);
      }
    }
  }

  async parseFile(file: File | null): Promise<string> {
    if (file == null) {
      return Promise.reject("Tried to upload a null file");
    }
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader();
      fileReader.onload = (event) => {
        let output = event.target!.result;
        if (typeof output === "string") {
          resolve(output);
        }
        reject("File did not read as string");
      };
      fileReader.onerror = (error) => reject(error);
      fileReader.readAsText(file);
    });
  }

  async openFile(file?: string) {
    if (file === undefined) {
      var selectedFile = await dialog.open({
        title: "Save Document",
        multiple: false,
        filters: [
          {
            name: "Trajopt Document",
            extensions: ["chor"],
          },
        ],
      });
      if (selectedFile === null) return;
      if (Array.isArray(selectedFile)) {
        selectedFile = selectedFile[0];
      }
      file = selectedFile;
    }
    console.log("Opening", file);

    this.model.uiState.setSaveFileName(file);
    var projectRoot = await path.dirname(file);

    this.loadFileContents(await fs.readTextFile(file));
    this.model.document.setProjectRoot(projectRoot);
    if (this.model.document.isRobotProject) {
      await invoke("expand_fs_scope", { path: projectRoot, isFile: false });
      for (let pathToLoad of this.model.document.pathlist.paths.values()) {
        await pathToLoad.loadTrajectory();
      }

    }
    this.model.document.history.clear();
    console.log(this.model.document.projectRoot);
  }
  async onFileUpload(file: File | null) {
    await this.parseFile(file)
      .then((content) => {
        const parsed = JSON.parse(content);
        if (validate(parsed)) {
          this.model.fromSavedDocument(parsed);
        } else {
          console.error("Invalid Document JSON");
          toast.error(
            "Could not parse selected document (Is it a choreo document?)",
            {
              containerId: "MENU",
            }
          );
        }
      })
      .catch((err) => {
        console.log(err);
        toast.error("File load error: " + err, {
          containerId: "MENU",
        });
      });
  }

  async exportTrajectory(uuid: string, filePath?: string | null) {
    const toExport = this.model.document.pathlist.paths.get(uuid);
    if (toExport === undefined) {
      console.error("Tried to export trajectory with unknown uuid: ", uuid);
      toast.error("Tried to export trajectory with unknown uuid", {
        autoClose: 5000,
        hideProgressBar: false,
        containerId: "MENU",
      });
      return;
    }
    const trajectory = toExport.getSavedTrajectory();
    if (trajectory === null) {
      console.error("Tried to export ungenerated trajectory: ", uuid);
      toast.error("Cannot export ungenerated trajectory", {
        autoClose: 5000,
        hideProgressBar: false,
        containerId: "MENU",
      });
      return;
    }
    const content = JSON.stringify({samples: trajectory}, undefined, 4);
    if (filePath === undefined) {
      filePath = await dialog.save({
        title: "Export Trajectory",
        defaultPath: `${toExport.name}.traj`,
        filters: [
          {
            name: "Trajopt Trajectory",
            extensions: ["traj"],
          },
        ],
      });
    }

    if (filePath) {
      var dirname = await path.dirname(filePath);
      console.log(dirname);
      if (!(await fs.exists(dirname))) {
        await fs.createDir(dirname);
      }
      await fs.writeTextFile(filePath, content);
    }
  }
  async exportActiveTrajectory() {
    return await this.exportTrajectory(
      this.model.document.pathlist.activePathUUID
    );
  }

  async loadFileContents(contents: string) {
    const parsed = JSON.parse(contents);
    if (validate(parsed)) {
      this.model.fromSavedDocument(parsed);
      this.model.document.history.clear();
    } else {
      console.error("Invalid Document JSON");
    }
  }

  async saveFile() {
    const content = JSON.stringify(this.model.asSavedDocument(), undefined, 4);
    if (!VERSIONS[SAVE_FILE_VERSION].validate(this.model.asSavedDocument())) {
      console.warn("Invalid Doc JSON:\n" + "\n" + content);
      return;
    }
    var filePath: string | null;
    if (this.model.uiState.saveFileName !== "") {
      filePath = this.model.uiState.saveFileName;
    } else {
      filePath = await dialog.save({
        title: "Save Document",
        filters: [
          {
            name: "Trajopt Document",
            extensions: ["chor"],
          },
        ],
      });
    }

    if (filePath) {
      this.model.uiState.setSaving(true);
      this.model.uiState.setSaveFileName(filePath);
      var dirname = await path.dirname(filePath);
      console.log(dirname);
      if (!(await fs.exists(dirname))) {
        await fs.createDir(dirname);
      }
      await fs.writeTextFile(filePath, content);
      this.model.uiState.setSaving(false);
    }
  }

  async downloadJSONString(content: string, name: string) {
    const element = document.createElement("a");
    const file = new Blob([content], { type: "application/json" });
    let link = URL.createObjectURL(file);
    //window.open(link, '_blank');
    //Uncomment to "save as..." the file
    element.href = link;
    element.download = name;
    element.click();
  }
}
let DocumentManagerContext = createContext(new DocumentManager());
export default DocumentManagerContext;