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
    this.loadPriorFile();

    reaction(
      () => this.model.document.history.undoIdx,
      () => {
        if (this.model.uiState.saveFileName !== "") {
          this.saveFile();
          console.log("saved");
        }
      }
    );
  }

  async loadPriorFile() {
    var saveFileFromStorage = localStorage.getItem("saveFileName");
    if (
      saveFileFromStorage !== null &&
      saveFileFromStorage !== "" &&
      (await fs.exists(saveFileFromStorage))
    ) {
      this.openFile(saveFileFromStorage);
    } else {
      this.newFile();
    }
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
      // save the chor file
      this.model.uiState.setSaveFileName(chorFilePath);
      this.model.document.setIsRobotProject(true);
      this.model.document.setProjectRoot(projectRoot);
      await invoke("expand_fs_scope", { path: projectRoot, isFile: false });
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

  async exportTrajectory(uuid: string, filePath?: string | null) {
    const toExport = this.model.document.pathlist.paths.get(uuid);
    if (toExport === undefined) {
      console.error("Tried to export trajectory with unknown uuid: ", uuid);
      return;
    }
    const trajectory = toExport.getSavedTrajectory();
    if (trajectory === null) {
      console.error("Tried to export ungenerated trajectory: ", uuid);
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