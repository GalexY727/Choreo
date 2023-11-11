import { Instance, types } from "mobx-state-tree";
import {
  SavedDocument,
  SavedTrajectorySample,
  SAVE_FILE_VERSION,
  updateToCurrent,
} from "./DocumentSpecTypes";

import { invoke } from "@tauri-apps/api/tauri";
import { RobotConfigStore } from "./RobotConfigStore";
import { SelectableItemTypes, UIStateStore } from "./UIStateStore";
import { PathListStore } from "./PathListStore";
import { TrajectorySampleStore } from "./TrajectorySampleStore";
import { UndoManager } from "mst-middlewares";
import { IHolonomicPathStore } from "./HolonomicPathStore";
import { toJS } from "mobx";
import { type } from "os";
import { path } from "@tauri-apps/api";
import { getCurrent } from "@tauri-apps/api/window";

export const DocumentStore = types
  .model("DocumentStore", {
    pathlist: PathListStore,
    robotConfig: RobotConfigStore,
    isRobotProject: false,
    projectRoot: "",
    trajDir: "",
  })
  .volatile((self) => ({
    history: UndoManager.create({}, { targetStore: self }),
  }))
  .actions((self) => ({
    setIsRobotProject(isRobotProject: boolean) {
      self.history.withoutUndo(() => {
        self.isRobotProject = isRobotProject;
        if (self.isRobotProject) {
          self.trajDir = `${self.projectRoot}${path.sep}src${path.sep}main${path.sep}deploy${path.sep}choreo`;
        } else {
          self.trajDir = "";
        }
      });
    },
    /**
     * Sets the project root filepath.
     * Will also update trajdir if the project is a robot project
     * @param projectRoot The absolute path to the project root directory (the directory containing the .chor file)
     */
    setProjectRoot(projectRoot: string) {
      self.history.withoutUndo(() => {
        self.projectRoot = projectRoot;
        if (self.isRobotProject) {
          self.trajDir = `${self.projectRoot}${path.sep}src${path.sep}main${path.sep}deploy${path.sep}choreo`;
        } else {
          self.trajDir = "";
        }
      });
    },
  }));

export interface IDocumentStore extends Instance<typeof DocumentStore> {}

const StateStore = types
  .model("StateStore", {
    uiState: UIStateStore,
    document: DocumentStore,
  })
  .views((self) => ({
    asSavedDocument(): SavedDocument {
      return {
        version: SAVE_FILE_VERSION,
        robotConfiguration: self.document.robotConfig.asSavedRobotConfig(),
        paths: self.document.pathlist.asSavedPathList(),
        isRobotProject: self.document.isRobotProject,
      };
    },
  }))
  .actions((self) => {
    return {
      afterCreate() {
        // self.document.history = UndoManager.create(
        //   {},
        //   { targetStore: self.document }
        // );
      },
      fromSavedDocument(document: any) {
        document = updateToCurrent(document);
        self.document.robotConfig.fromSavedRobotConfig(
          document.robotConfiguration
        );
        self.document.pathlist.fromSavedPathList(document.paths);
        if (Object.hasOwn(document, "isRobotProject")) {
          self.document.isRobotProject = document["isRobotProject"];
        }
        console.log("fromSavedDocument");
      },
      select(item: SelectableItemTypes) {
        self.document.history.withoutUndo(()=>{
          self.uiState.setSelectedSidebarItem(item);
        })
      },
      cancelGeneration(name: string) {
        getCurrent().emit(`cancel-${name}`);
      },
      generatePath(uuid: string) {
        const pathStore = self.document.pathlist.paths.get(uuid);
        if (pathStore === undefined) {
          return;
        }
        new Promise((resolve, reject) => {
          //pathStore.setTrajectory([]);
          if (pathStore.waypoints.length < 2) {
            return;
          }
          pathStore.constraints.forEach((constraint) => {
            if (constraint.issues.length > 0) {
              throw new Error(constraint.issues.join(", "));
            }
          });
          pathStore.waypoints.forEach((wpt, idx) => {
            if (wpt.isInitialGuess) {
              if (idx == 0) {
                throw new Error(
                  "Cannot start a path with an initial guess point."
                );
              } else if (idx == pathStore.waypoints.length - 1) {
                throw new Error(
                  "Cannot end a path with an initial guess point."
                );
              }
            }
            if (wpt.isInitialGuess) {
              if (idx == 0) {
                throw new Error(
                  "Cannot start a path with an initial guess point."
                );
              } else if (idx == pathStore.waypoints.length - 1) {
                throw new Error(
                  "Cannot end a path with an initial guess point."
                );
              }
            }
          });
          pathStore.setGenerating(true);
          resolve(pathStore);
        })
          .then(async () => {
            return invoke("generate", {
              filepath: self.uiState.saveFileName,
              pathName: pathStore.name,
              output: pathStore.trajFile(),
              uuid
            });
          })
          .then((rust_traj) => {
            let newTraj: Array<SavedTrajectorySample> = [];
            // @ts-ignore
            rust_traj.samples.forEach((samp) => {
              let newPoint = TrajectorySampleStore.create();
              newPoint.setX(samp.x);
              newPoint.setY(samp.y);
              newPoint.setHeading(samp.heading);
              newPoint.setAngularVelocity(samp.angular_velocity);
              newPoint.setVelocityX(samp.velocity_x);
              newPoint.setVelocityY(samp.velocity_y);
              newPoint.setTimestamp(samp.timestamp);
              newTraj.push(newPoint);
            });
            pathStore.setTrajectory(newTraj);
          })
          .finally(() => {
            pathStore.setGenerating(false);
            self.uiState.setPathAnimationTimestamp(0);
          });
      },
    };
  });

export default StateStore;
export interface IStateStore extends Instance<typeof StateStore> {}
