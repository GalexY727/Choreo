use serde::{Deserialize, Deserializer};
use std::io::{stdout, Read, Write};
use std::ops::Deref;
use std::os::windows::prelude::AsRawHandle;
use std::path::{self, Path};
use std::process::{self, Command, Stdio};
use std::time::Duration;
use std::{collections::HashMap, fs, sync::Mutex};
use tauri::api::clap::builder::ValueParserFactory;
use tauri::async_runtime::JoinHandle;
use tokio::time::sleep;
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
// #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use clap::Parser;
use serde_with::serde_as;
use std::os::windows::process::CommandExt;
use tauri::State;
use tauri::{api::file, Manager};
use tokio::sync::oneshot::channel;

use trajoptlib::{
    HolonomicTrajectory, HolonomicTrajectorySample, InitialGuessPoint, SwerveDrivetrain,
    SwerveModule, SwervePathBuilder,
};

mod document;
use crate::document::{
  ChoreoConstraintScope,
  ChoreoDocument,
  ChoreoPath,
  ChoreoRobotConfig,
  ChoreoWaypoint,
  ChoreoWaypointId,
  Constraints,
  wpt_id_to_idx
};


fn fix_scope(wpt_id: usize, removed_idxs: &Vec<usize>) -> usize {
    let mut to_subtract: usize = 0;
    for removed in removed_idxs {
        if *removed < wpt_id {
            to_subtract += 1;
        }
    }
    return wpt_id - to_subtract;
}

#[tauri::command]
async fn expand_fs_scope(
    app_handle: tauri::AppHandle,
    path: &str,
    is_file: bool,
) -> Result<(), String> {
    if is_file {
        let _ = app_handle.app_handle().fs_scope().allow_file(path);
    } else {
        let _ = app_handle
            .app_handle()
            .fs_scope()
            .allow_directory(path, true);
    }
    Ok(())
}

#[tauri::command]
async fn generate(
    app_handle: tauri::AppHandle,
    filepath: &str,
    path_name: &str,
    output: &str,
    uuid: &str,
) -> Result<HolonomicTrajectory, String> {
    let moved_filepath = filepath.to_owned();
    let moved_path_name = path_name.to_owned();
    let moved_output = output.to_owned();

    let current_exe = std::env::current_exe();
    if (current_exe.is_ok()) {
        let mut handle = Command::new(current_exe.unwrap())
            .arg("--chor")
            .arg(filepath)
            .arg("--path")
            .arg(path_name)
            .arg("--output")
            .arg(output)
            .spawn()
            .unwrap();

        let (send, recv) = channel::<()>();
        let event_listener = app_handle.once_global(String::from("cancel-") + uuid, move |_| {
            println!("I saw that");
            send.send(());
        });
        tokio::select! {
            _ = recv => {
              handle.kill().expect("kill failed")}
            _ = async {
            while handle.try_wait().is_ok_and(|option| {option.is_none()}) {
              sleep(Duration::from_millis(200)).await;
            }} => {}

        }
        app_handle.unlisten(event_listener);
        // let mut out = handle.stdout.take().expect("No stdout on child");
        // let raw_handle = handle.as_;

        // let buf = &mut [0; 1];
        // loop {
        //   let contents_opt = out.read_exact(buf);
        //   if (contents_opt.is_err()) {break;}
        //   // stdout().write_all(buf);
        // }
        let result: HolonomicTrajectory = serde_json::from_str::<HolonomicTrajectory>(
            fs::read_to_string(Path::new(output)).unwrap().as_str(),
        )
        .unwrap();
        // serde_json::from_str::<Vec<HolonomicTrajectorySample>>(
        //   file::read_string(Path::new(String::from(output))).unwrap_or("".to_string())
        // ).unwrap_or(Vec!());

        Ok(result)
    } else {
        Err(String::from("could not start child process"))
    }
}

struct ParsedConstraintScope {
    start: usize,
    end: usize,
    segment: bool,
}

fn parse_constraints_scope(
    scope: &ChoreoConstraintScope,
    total_pnts: usize,
    rm: &Vec<usize>
) -> ParsedConstraintScope {
    let mut start: usize = 0;
    let mut end: usize = 0;
    let mut segment = false;
    match scope {
        ChoreoConstraintScope::Waypoint(idx) => start = wpt_id_to_idx(&idx[0], total_pnts),
        ChoreoConstraintScope::Segment(idx) => {
            start = fix_scope(wpt_id_to_idx(&idx[0], total_pnts), rm);
            end = fix_scope(wpt_id_to_idx(&idx[1], total_pnts), rm);
            if start != end {
                segment = true;
                if (start > end) {
                    let tmp = start;
                    start = end;
                    end = tmp;
                }
            }
        }
    };
    return ParsedConstraintScope {
        start,
        end,
        segment,
    };
}

#[tauri::command]
async fn generate_trajectory(
    path: Vec<ChoreoWaypoint>,
    config: ChoreoRobotConfig,
    constraints: Vec<Constraints>,
    filepath: &str,
) -> Result<HolonomicTrajectory, String> {
    let mut path_builder = SwervePathBuilder::new();
    let mut total_pnts: usize = 0;
    let mut wpt_cnt: usize = 0;
    let mut rm: Vec<usize> = Vec::new();
    for i in 0..path.len() {
        let wpt: &ChoreoWaypoint = &path[i];
        if wpt.isInitialGuess {
            let guess_point: InitialGuessPoint = InitialGuessPoint {
                x: wpt.x,
                y: wpt.y,
                heading: wpt.heading,
            };
            path_builder.sgmt_initial_guess_points(wpt_cnt, &vec![guess_point]);
            rm.push(i)
        } else if wpt.headingConstrained && wpt.translationConstrained {
            path_builder.pose_wpt(wpt_cnt, wpt.x, wpt.y, wpt.heading);
            wpt_cnt += 1;
        } else if wpt.translationConstrained {
            path_builder.translation_wpt(wpt_cnt, wpt.x, wpt.y, wpt.heading);
            wpt_cnt += 1;
        } else {
            path_builder.empty_wpt(wpt_cnt, wpt.x, wpt.y, wpt.heading);
            wpt_cnt += 1;
        }
        total_pnts += 1;
    }
    // fix the scopes

    for c in 0..constraints.len() {
        let constraint: &Constraints = &constraints[c];
        let parsed_scope: ParsedConstraintScope = match constraint {
            Constraints::WptVelocityDirection { scope, direction } => {
                parse_constraints_scope(scope, total_pnts, &rm)
            }
            Constraints::WptZeroVelocity { scope } => parse_constraints_scope(scope, total_pnts, &rm),
            Constraints::StopPoint { scope } => parse_constraints_scope(scope, total_pnts, &rm),
            Constraints::MaxVelocity { scope, velocity } => {
                parse_constraints_scope(scope, total_pnts, &rm)
            }
            Constraints::ZeroAngularVelocity { scope } => {
                parse_constraints_scope(scope, total_pnts, &rm)
            }
            Constraints::StraightLine { scope } => parse_constraints_scope(scope, total_pnts, &rm),
        };
        match constraint {
            Constraints::WptVelocityDirection { scope, direction } => {
                if !parsed_scope.segment {
                    path_builder.wpt_linear_velocity_direction(
                        fix_scope(parsed_scope.start, &rm),
                        *direction,
                    );
                }
            }
            Constraints::WptZeroVelocity { scope } => {
                if !parsed_scope.segment {
                    path_builder.wpt_linear_velocity_max_magnitude(
                        fix_scope(parsed_scope.start, &rm),
                        0.0f64,
                    );
                }
            }
            Constraints::StopPoint { scope } => {
                if !parsed_scope.segment {
                    path_builder.wpt_linear_velocity_max_magnitude(
                        fix_scope(parsed_scope.start, &rm),
                        0.0f64,
                    );
                    path_builder.wpt_angular_velocity(fix_scope(parsed_scope.start, &rm), 0.0);
                }
            }
            Constraints::MaxVelocity { scope, velocity } => {
                if !parsed_scope.segment {
                    path_builder.wpt_linear_velocity_max_magnitude(
                        fix_scope(parsed_scope.start, &rm),
                        *velocity,
                    );
                } else {
                    path_builder.sgmt_linear_velocity_max_magnitude(
                        fix_scope(parsed_scope.start, &rm),
                        fix_scope(parsed_scope.end, &rm),
                        *velocity,
                    );
                }
            }
            Constraints::ZeroAngularVelocity { scope } => {
                if !parsed_scope.segment {
                    path_builder.wpt_angular_velocity(fix_scope(parsed_scope.start, &rm), 0.0)
                } else {
                    path_builder.sgmt_angular_velocity(
                        fix_scope(parsed_scope.start, &rm),
                        fix_scope(parsed_scope.end, &rm),
                        0.0,
                    )
                }
            }
            Constraints::StraightLine { scope } => {
                if parsed_scope.segment {
                    let start = fix_scope(parsed_scope.start, &rm);
                    let end = fix_scope(parsed_scope.end, &rm);
                    if (start != end) {
                        for point in parsed_scope.start..parsed_scope.end {
                            let this_pt = fix_scope(point, &rm);
                            let next_pt = fix_scope(point + 1, &rm);
                            println!("{} {}", this_pt, next_pt);
                            if this_pt != start {
                                // points in between straight-line segments are automatically zero-velocity points
                                path_builder.wpt_linear_velocity_max_magnitude(this_pt, 0.0f64);
                            }
                            let x1 = path[this_pt].x;
                            let x2 = path[next_pt].x;
                            let y1 = path[this_pt].y;
                            let y2 = path[next_pt].y;
                            path_builder.sgmt_linear_velocity_direction(
                                this_pt,
                                next_pt,
                                (y2 - y1).atan2(x2 - x1),
                            )
                        }
                    }
                }
            }
            // add more cases here to impl each constraint.
        }
        // The below might be helpful
        // let Constraints!(scope, ..) = constraint;
        // match scope {
        //   ChoreoConstraintScope::Full(_) =>
        //     println!("Full Path")
        //   ,
        //   ChoreoConstraintScope::Segment(range) =>
        //     println!("From {} to {}", range.start, range.end),
        //   ChoreoConstraintScope::Waypoint(idx) =>
        //     println!("At {}", idx)
        // }
    }
    let half_wheel_base = config.wheelbase / 2.0;
    let half_track_width = config.trackWidth / 2.0;
    let drivetrain = SwerveDrivetrain {
        mass: config.mass,
        moi: config.rotationalInertia,
        modules: vec![
            SwerveModule {
                x: half_wheel_base,
                y: half_track_width,
                wheel_radius: config.wheelRadius,
                wheel_max_angular_velocity: config.wheelMaxVelocity,
                wheel_max_torque: config.wheelMaxTorque,
            },
            SwerveModule {
                x: half_wheel_base,
                y: -half_track_width,
                wheel_radius: config.wheelRadius,
                wheel_max_angular_velocity: config.wheelMaxVelocity,
                wheel_max_torque: config.wheelMaxTorque,
            },
            SwerveModule {
                x: -half_wheel_base,
                y: half_track_width,
                wheel_radius: config.wheelRadius,
                wheel_max_angular_velocity: config.wheelMaxVelocity,
                wheel_max_torque: config.wheelMaxTorque,
            },
            SwerveModule {
                x: -half_wheel_base,
                y: -half_track_width,
                wheel_radius: config.wheelRadius,
                wheel_max_angular_velocity: config.wheelMaxVelocity,
                wheel_max_torque: config.wheelMaxTorque,
            },
        ],
    };
    //path_builder.set_bumpers(config.bumperLength, config.bumperWidth);
    path_builder.set_drivetrain(&drivetrain);
    let output = path_builder.generate();

    match output {
        Ok(traj) => {
            println!("Filepath {}", filepath);
            if filepath != "" {
                let the_path = Path::new(filepath);
                let _dir_path = the_path.parent();
                match the_path.parent() {
                    Some(dir_path) => {
                        if !(dir_path.try_exists().unwrap_or(false)) {
                            let _ = fs::create_dir(dir_path);
                        }
                    }
                    _ => {}
                }
                let _ = fs::write(the_path, serde_json::to_string_pretty(&traj).unwrap());
            }
            Ok(traj)
        }
        Err(message) => Err(message),
    }
}

async fn parseAndGenerate(
    contents: &str,
    path_name: &str,
    output: &str,
) -> Result<HolonomicTrajectory, String> {
    let chor_file: ChoreoDocument = serde_json::from_str(contents).unwrap();
    //println!("{:?}", chor_file);
    let path_opt = chor_file.paths.get::<String>(&path_name.to_string());
    match path_opt {
        Some(path) => {
            println!("about to generate");
            generate_trajectory(
                path.waypoints.to_vec(),
                chor_file.robotConfiguration,
                path.constraints.to_vec(),
                output,
            )
            .await
        }
        None => Err(format!("Unknown Path {}", path_name)),
    }
}

#[tokio::main]
async fn main() {
    // Build CLI parser
    let cmd = clap::Command::new("choreo")
        .arg(
            clap::arg!(--"chor" <PATH>)
                .value_parser(clap::builder::NonEmptyStringValueParser::new()),
        )
        .arg(
            clap::arg!(--"path" <PATH>)
                .value_parser(clap::builder::NonEmptyStringValueParser::new()),
        )
        .arg(
            clap::arg!(--"output" <PATH>)
                .value_parser(clap::builder::NonEmptyStringValueParser::new()),
        );

    let args: Vec<String> = std::env::args().collect();
    if (args.len() > 1) {
        let matches = cmd.get_matches();
        let chor_opt = matches.get_one::<String>("chor");
        let path_opt = matches.get_one::<String>("path");
        let output_opt = matches.get_one::<String>("output");

        let chor_path = chor_opt.expect("chor file not provided").to_owned();
        let path_name = path_opt.expect("path name not provided").to_owned();
        let output_name = output_opt.expect("output file not provided").to_owned();
        let chor_path_clone = chor_path.clone();
        let chor_filepath = Path::new(chor_path_clone.as_str());
        if chor_filepath.try_exists().unwrap_or(false) {
            let contents = fs::read_to_string(chor_filepath).unwrap();
            let handle = tauri::async_runtime::spawn(async move {
                parseAndGenerate(
                    contents.as_str(),
                    path_name.as_str(),
                    output_name.as_str(),
                )
                .await;
            });
            let wait = handle.await;
        } else {
            eprintln!("Provided .chor file does not exist: {}", chor_path.as_str());
            std::process::exit(exitcode::NOINPUT);
        }
        println!("{:?} {:?}", chor_opt, path_opt);
    } else {
      // No CLI args? start up tauri
        tauri::Builder::default()
            .plugin(tauri_plugin_persisted_scope::init())
            .invoke_handler(tauri::generate_handler![generate, expand_fs_scope])
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}
