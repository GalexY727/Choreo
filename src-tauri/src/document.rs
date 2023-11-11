use std::{collections::HashMap, iter::Map};

use serde_with::serde_as;

#[allow(non_snake_case)]
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ChoreoWaypoint {
    pub x: f64,
    pub y: f64,
    pub heading: f64,
    pub isInitialGuess: bool,
    pub translationConstrained: bool,
    pub headingConstrained: bool,
}

#[allow(non_snake_case)]
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ChoreoRobotConfig {
    pub mass: f64,
    pub rotationalInertia: f64,
    pub wheelMaxVelocity: f64,
    pub wheelMaxTorque: f64,
    pub wheelRadius: f64,
    pub bumperWidth: f64,
    pub bumperLength: f64,
    pub wheelbase: f64,
    pub trackWidth: f64,
}

#[allow(non_snake_case)]
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ChoreoDocument {
    pub version: String,
    pub robotConfiguration: ChoreoRobotConfig,
    pub paths: HashMap<String, ChoreoPath>,
}

#[allow(non_snake_case)]
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ChoreoPath {
    pub waypoints: Vec<ChoreoWaypoint>,
    //#[serde(deserialize_with = "deserialize_constraints")]
    pub constraints: Vec<Constraints>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(untagged)]
pub enum ChoreoWaypointId {
    Str(String),
    Num(usize),
}

#[allow(non_snake_case)]
#[serde_as]
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(untagged)]

pub enum ChoreoConstraintScope {
    Segment([ChoreoWaypointId; 2]),

    Waypoint([ChoreoWaypointId; 1]),
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(tag = "type")]
// Add constraint type, scope, and properties
pub enum Constraints {
    WptVelocityDirection {
        scope: ChoreoConstraintScope,
        direction: f64,
    },
    WptZeroVelocity {
        scope: ChoreoConstraintScope,
    },
    StopPoint {
        scope: ChoreoConstraintScope,
    },
    MaxVelocity {
        scope: ChoreoConstraintScope,
        velocity: f64,
    },
    ZeroAngularVelocity {
        scope: ChoreoConstraintScope,
    },
    StraightLine {
        scope: ChoreoConstraintScope,
    },
}
// Also add the constraint type here
//define_enum_macro!(BoundsZeroVelocity, WptVelocityDirection, WptZeroVelocity);

pub fn wpt_id_to_idx(wpt_id: &ChoreoWaypointId, total_pnts: usize) -> usize {
    match (wpt_id) {
        ChoreoWaypointId::Str(string) => {
            if string.cmp(&String::from("last")).is_eq() {
                return total_pnts;
            }
            if string.cmp(&String::from("first")).is_eq() {
                return 0;
            }
        }
        ChoreoWaypointId::Num(id) => {
            return *id;
        }
    };
    return 0;
}

pub enum ChoreoDocumentVersion {
    v0_2 {
        version: String,
        paths: Map<String, ChoreoPath>,
        robotConfiguration: ChoreoRobotConfig,
        isRobotProject:bool

    }
}