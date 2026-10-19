"""State-space builders shared by several test modules."""

import numpy as np

from cabana._models import GridTopology, StateSpace


def make_states(labels, n_states, exclusive=True, topology=None, kind="categorical"):
    labels = np.asarray(labels)
    oh = np.zeros((labels.size, n_states), dtype=bool)
    ok = labels >= 0
    oh[np.flatnonzero(ok), labels[ok]] = True
    return StateSpace(
        name="s",
        onehot=oh,
        state_names=[str(i) for i in range(n_states)],
        kind="grid" if topology is not None else kind,
        exclusive=exclusive,
        topology=topology,
    )


def grid_topology(shape):
    return GridTopology(
        shape=shape,
        edges=[np.arange(n + 1, dtype=float) for n in shape],
        axis_names=[f"a{i}" for i in range(len(shape))],
    )


def grid_data(seed=0, n_time=600, shape=(4, 5), n_cells=3):
    rng = np.random.default_rng(seed)
    topo = grid_topology(shape)
    labels = rng.integers(0, topo.n_states, n_time)
    st = make_states(labels, topo.n_states, topology=topo)
    act = rng.poisson(0.3, (n_cells, n_time)).astype(float) * rng.random((n_cells, n_time))
    act[0, labels == 3] *= 5
    mask = rng.random(n_time) > 0.3
    mask[100:150] = False
    return act, st, mask
