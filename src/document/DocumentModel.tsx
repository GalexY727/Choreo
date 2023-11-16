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
import { toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.min.css";
import { Box } from "@mui/material";

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
      async generatePath(uuid: string) {
        const pathStore = self.document.pathlist.paths.get(uuid);
        if (pathStore === undefined) {
          return new Promise((resolve, reject) =>
            reject("Path store is undefined")
          );
        }
        return new Promise((resolve, reject) => {
          const controlIntervalOptResult =
            pathStore.optimizeControlIntervalCounts(self.document.robotConfig);
          if (controlIntervalOptResult !== undefined) {
            return new Promise((resolve, reject) =>
              reject(controlIntervalOptResult)
            );
          }
          pathStore.setTrajectory([]);
          if (pathStore.waypoints.length < 2) {
            return;
          }
          pathStore.constraints.forEach((constraint) => {
            if (constraint.issues.length > 0) {
              reject(constraint.issues.join(", "));
            }
          });
          pathStore.waypoints.forEach((wpt, idx) => {
            if (wpt.isInitialGuess) {
              if (idx == 0) {
                reject("Cannot start a path with an initial guess point.");
              } else if (idx == pathStore.waypoints.length - 1) {
                reject("Cannot end a path with an initial guess point.");
              }
            }
            if (wpt.isInitialGuess) {
              if (idx == 0) {
                reject("Cannot start a path with an initial guess point.");
              } else if (idx == pathStore.waypoints.length - 1) {
                reject("Cannot end a path with an initial guess point.");
              }
            }
          });
          pathStore.setGenerating(true);
          resolve(pathStore);
        })
          .then(async () => {
            return invoke("generate", {
              path: pathStore.waypoints,
              config: self.document.robotConfig,
              constraints: pathStore.asSolverPath().constraints
            });
          })
          .then((rust_traj) => {
            let newTraj: Array<SavedTrajectorySample> = [];
            // @ts-ignore
            rust_traj.samples.forEach((samp) => {
              newTraj.push({
                x:samp.x,
                y:samp.y,
                heading: samp.heading,
                angularVelocity:samp.angular_velocity,
                velocityX: samp.velocity_x,
                velocityY: samp.velocity_y,
                timestamp: samp.timestamp
              });
            });
            console.log(newTraj);
            pathStore.setTrajectory(newTraj);
            if (newTraj.length == 0) throw "No Trajectory Returned";
          },
          (e) => {
            console.error(e);
            if ((e as string).includes("Infeasible_Problem_Detected")) {
              throw "Infeasible Problem Detected";
            }
            if ((e as string).includes("Maximum_Iterations_Exceeded")) {
              throw "Maximum Iterations Exceeded";
            }
            throw e;
          }).then(()=>pathStore.exportTrajectory())
          .finally(() => {
            pathStore.setGenerating(false);
            self.uiState.setPathAnimationTimestamp(0);
          });
      },
    };
  });

export default StateStore;
export interface IStateStore extends Instance<typeof StateStore> {}
