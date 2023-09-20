import React, { Component } from "react";
import DocumentManagerContext from "./document/DocumentManager";
import { observer } from "mobx-react";
import {
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import MenuIcon from "@mui/icons-material/Menu";
import UploadIcon from "@mui/icons-material/UploadFile";
import IconButton from "@mui/material/IconButton";
import FileDownload from "@mui/icons-material/FileDownload";
import Tooltip from "@mui/material/Tooltip";
import { NoteAddOutlined } from "@mui/icons-material";
type Props = {};

type State = {};

class AppMenu extends Component<Props, State> {
  static contextType = DocumentManagerContext;
  // @ts-ignore
  context!: React.ContextType<typeof DocumentManagerContext>;
  state = {};

  render() {
    let { mainMenuOpen, toggleMainMenu } = this.context.model.uiState;
    return (
      <Drawer
        ModalProps={{ onBackdropClick: toggleMainMenu }}
        anchor="left"
        open={mainMenuOpen}
      >
        <div
          style={{
            width: "var(--sidebar-width)",
            backgroundColor: "var(--background-dark-gray)",
            height: "100%",
          }}
        >
          <div
            style={{
              flexShrink: 0,

              height: "var(--top-nav-height)",
              borderBottom: "thin solid var(--divider-gray)",
              display: "flex",
              flexDirection: "row",
              justifyContent: "flex-start",
              alignItems: "center",
              paddingLeft: 0,
              zIndex: 1000,
            }}
          >
            <Tooltip title="Main Menu">
              <IconButton
                onClick={() => {
                  toggleMainMenu();
                }}
              >
                <MenuIcon></MenuIcon>
              </IconButton>
            </Tooltip>
            Choreo
          </div>
          <List>
              <ListItemButton
                onClick={()=>this.context.openFile()}
              >
                <ListItemIcon>
                  <UploadIcon />
                </ListItemIcon>
                <ListItemText primary="Open File"></ListItemText>
              </ListItemButton>
            <ListItemButton
              onClick={() => {
                this.context.saveFile();
              }}
            >
              <ListItemIcon>
                <SaveIcon />
              </ListItemIcon>
              <ListItemText primary="Save File"></ListItemText>
            </ListItemButton>
            <ListItemButton
              onClick={() => {
                this.context.newFile();
              }}
            >
              <ListItemIcon>
                <NoteAddOutlined />
              </ListItemIcon>
              <ListItemText primary="New File"></ListItemText>
            </ListItemButton>
            <ListItemButton
              onClick={() => {
                this.context.exportActiveTrajectory();
              }}
            >
              <ListItemIcon>
                <FileDownload />
              </ListItemIcon>
              <ListItemText primary="Export Trajectory"></ListItemText>
            </ListItemButton>
          </List>
        </div>
      </Drawer>
    );
  }
}
export default observer(AppMenu);
