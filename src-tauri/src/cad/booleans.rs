use cadrum::Solid;

use super::state::{KernelHandle, KernelState};
use super::types::KernelError;

#[derive(Clone, Copy)]
enum Op {
    Union,
    Subtract,
    Intersect,
}

fn run(op: Op, base: Solid, tools: &[Solid]) -> Result<Vec<Solid>, KernelError> {
    let base_refs: [&Solid; 1] = [&base];
    Ok(match op {
        Op::Union => Solid::boolean_union(base_refs, tools.iter())?,
        Op::Subtract => Solid::boolean_subtract(base_refs, tools.iter())?,
        Op::Intersect => Solid::boolean_intersect(base_refs, tools.iter())?,
    })
}

fn dispatch(
    op: Op,
    state: &KernelState,
    target: &KernelHandle,
    tools: &[KernelHandle],
) -> Result<KernelHandle, KernelError> {
    let base = state.clone_solid(target)?;
    let tool_solids: Vec<_> = tools
        .iter()
        .map(|h| state.clone_solid(h))
        .collect::<Result<_, _>>()?;
    let result = run(op, base, &tool_solids)?;
    let solid = take_first(result)?;
    state.replace(target, solid)?;
    for handle in tools {
        state.remove(handle)?;
    }
    Ok(target.clone())
}

pub fn union(
    state: &KernelState,
    target: &KernelHandle,
    tools: &[KernelHandle],
) -> Result<KernelHandle, KernelError> {
    dispatch(Op::Union, state, target, tools)
}

pub fn subtract(
    state: &KernelState,
    target: &KernelHandle,
    tools: &[KernelHandle],
) -> Result<KernelHandle, KernelError> {
    dispatch(Op::Subtract, state, target, tools)
}

pub fn intersect(
    state: &KernelState,
    target: &KernelHandle,
    tools: &[KernelHandle],
) -> Result<KernelHandle, KernelError> {
    dispatch(Op::Intersect, state, target, tools)
}

fn take_first(mut solids: Vec<Solid>) -> Result<Solid, KernelError> {
    solids.pop().ok_or(KernelError::Cadrum(
        "boolean operation produced no solids".into(),
    ))
}
