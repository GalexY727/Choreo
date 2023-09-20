import { createContext } from "react";
import StateStore, { IStateStore } from "./DocumentModel";
import { dialog, fs } from "@tauri-apps/api";
import { v4 as uuidv4 } from "uuid";
import { VERSIONS, validate } from "./DocumentSpecTypes";
import { applySnapshot, getRoot, onPatch } from "mobx-state-tree";
import { toJS } from "mobx";
import { window } from "@tauri-apps/api"
import { TauriEvent } from "@tauri-apps/api/event"

export class DocumentManager {
  simple: any;
  undo() {
    this.model.document.history.canUndo && this.model.document.history.undo();
  }
  redo() {
    this.model.document.history.canRedo && this.model.document.history.redo();
  }
  get history() {
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
      },
    });
    window.getCurrent().listen(TauriEvent.WINDOW_CLOSE_REQUESTED, async () => {
      if (this.model.uiState.saveFileName !== "") {this.saveFile()}
      else {
        if (await dialog.ask("Save project?", {title: "Choreo", type: "warning"})) {
          this.saveFile();
        }
      }
      window.getCurrent().close();
    })
    this.loadPriorFile();
  }

  async loadPriorFile() {
    var saveFileFromStorage = localStorage.getItem("saveFileName");
    if (saveFileFromStorage !== null && saveFileFromStorage !== "" && await fs.exists(saveFileFromStorage)) {
      this.loadFileContents(await fs.readTextFile(saveFileFromStorage))
      this.model.uiState.setSaveFileName(saveFileFromStorage)
      this.model.document.history.clear();
    }
    else {
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
      },
    });
    this.model.uiState.setSaveFileName("");
    this.model.document.pathlist.addPath("NewPath");
    this.model.document.history.clear();
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
  async onFileUpload(file: File | null) {
    await this.parseFile(file)
      .then((content) => {this.loadFileContents(content)})
      .catch((err) => console.log(err));
  }

  async openFile() {
    var file = await dialog.open({
      title: "Save Document",
      multiple: false,
      filters: [
        {
          name: "Trajopt Document",
          extensions: ["chor"],
        },
      ],
    });
    if (file===null) return;
    if (Array.isArray(file)) {
      file = file[0];
    }
    this.model.uiState.setSaveFileName(file)
    this.loadFileContents(await fs.readTextFile(file))
    
  }

  async exportTrajectory(uuid: string) {
    const path = this.model.document.pathlist.paths.get(uuid);
    if (path === undefined) {
      console.error("Tried to export trajectory with unknown uuid: ", uuid);
      return;
    }
    const trajectory = path.getSavedTrajectory();
    if (trajectory === null) {
      console.error("Tried to export ungenerated trajectory: ", uuid);
      return;
    }
    const content = JSON.stringify(trajectory, undefined, 4);
    const filePath = await dialog.save({
      title: "Export Trajectory",
      defaultPath: `${path.name}.traj`,
      filters: [
        {
          name: "Trajopt Trajectory",
          extensions: ["traj"],
        },
      ],
    });
    if (filePath) {
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
    if (!VERSIONS["v0.1"].validate(this.model.asSavedDocument())) {
      console.warn("Invalid Doc JSON:\n" + "\n" + content);
      return;
    }
    var  filePath : string | null;
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
      this.model.uiState.setSaveFileName(filePath);
      await fs.writeTextFile(filePath, content);
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
