"""
cabana.processing — change the values of the data with a setting you choose
(smoothing width, baseline window, speed cutoff). The data stays the same kind:
a trace in, a trace out.

Functions that take a Session return a new one through Session.with_neural, so
the history records what was done.

None of these functions have been written yet. Each will be written using the linked code as a reference.

Head orientation (on the neural clock, so no alignment step)

quaternion_to_head_orientation(q) -> radians, one per frame
    The yaw of a unit quaternion (qw, qx, qy, qz): the rotation about the vertical
    axis, which is the direction the head points. Pitch and roll are ignored. The
    zero of yaw is wherever the IMU started unless a calibration offset is given.
    No reference chosen yet; this is the standard quaternion-to-Euler formula.

Behavior (arrays on the behavior camera's clock, before alignment)

remove_tracker_jumps(x, y, t, max_speed)
    Set the position to NaN on the frame where the tracker jumps: speed between two
    frames above max_speed after a frame at or below it.
    neuro_py, behavior/preprocessing.py, filter_tracker_jumps (L11-55)
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/behavior/preprocessing.py#L11-L55

compute_speed(xy, t)
    Speed from position: np.gradient of position against time, then the length of
    the velocity vector.
    neuro_py, behavior/kinematics.py, get_velocity and get_speed (L7-88)
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/behavior/kinematics.py#L7-L88
    nelpy, auxiliary/_position.py, get_speed (L213-256): gradient taken separately
    in each stretch of recording
    https://github.com/nelpy/nelpy/blob/29c0f0ac49cf47bce405654e29594fc364cf9f8a/nelpy/auxiliary/_position.py#L213-L256

Neural activity (Session in, Session out)

smooth_neural(session, sigma_s, causal=False)
    Smooth each cell along time with a Gaussian whose width is given in seconds.
    causal=True uses only past frames (half a Gaussian), which delays onsets by
    about half the kernel; causal=False uses both sides.
    pynapple, core/time_series.py, Tsd.smooth (L618-) and Tsd.convolve (L527-): width
    in seconds converted to samples, kernel sums to 1
    https://github.com/pynapple-org/pynapple/blob/7fdadfbc105bf5f380cd8a1eaf07fe3bb5bc0a7e/pynapple/core/time_series.py#L618-L650
    linfangu, utils/plotting/heatmap_psth.m (L20): half-Gaussian smoothing of the
    raster (the function itself is not in that repo)
    https://github.com/linfangu/Computational-neuroscience-toolbox/blob/73fd0598ed8e421f5c2c3b61ea3a5b2c5e568154/utils/plotting/heatmap_psth.m#L20
    Canton, Figure_5_PCA_dataframe_creation.py (L131-136): moving average of the
    window length given in seconds
    https://github.com/pinto-lab-nu/Canton-JoshEtAl2025/blob/8b8728dc7b4f92cda38235a7dbae9687f3e5af24/Figure_5_PCA_dataframe_creation.py#L131-L136

zscore_neural(session, reference=None)
    Subtract each cell's mean and divide by its standard deviation. The mean and
    standard deviation come from the `reference` frames if given (for example a
    baseline), otherwise from the whole session.
    optinist, wrappers/optinist/utils.py, standard_norm (L1-6): StandardScaler with
    separate switches for mean and std
    https://github.com/oist/optinist/blob/c8f9526300b63bb7bfa7440bbaece3d7505667b0/studio/app/optinist/wrappers/optinist/utils.py#L1-L6
    Canton, Figure_5_PCA_dataframe_creation.py (L144-150 and L236): mean and std from
    baseline frames, reused for the trials
    https://github.com/pinto-lab-nu/Canton-JoshEtAl2025/blob/8b8728dc7b4f92cda38235a7dbae9687f3e5af24/Figure_5_PCA_dataframe_creation.py#L144-L150
    linfangu, example_pca_by_bout.m (L21): z-score of the whole recording
    https://github.com/linfangu/Computational-neuroscience-toolbox/blob/73fd0598ed8e421f5c2c3b61ea3a5b2c5e568154/example_pca_by_bout.m#L21

convolve_events(session, kernel="gaussian", sigma_s=...)
    Turn deconvolved events into a continuous trace by counting
    them per frame and smoothing with a kernel.
    nelpy, utils.py (L520-541): counts per bin divided by bin width to get a rate,
    then Gaussian filter
    https://github.com/nelpy/nelpy/blob/29c0f0ac49cf47bce405654e29594fc364cf9f8a/nelpy/utils.py#L520-L541
    Representational_Dynamics_demo, src/repdyn/cell_classes.py, calculate_gaussian_kernel
    (L47-50): kernel normalised to sum to 1
    https://github.com/UladzislauBarayeu/Representational_Dynamics_demo/blob/2d267d21066f6e59087427ecedde867c825e414c/src/repdyn/cell_classes.py#L47-L50
    pynapple, core/time_series.py, Tsd.smooth (L618-)
    https://github.com/pynapple-org/pynapple/blob/7fdadfbc105bf5f380cd8a1eaf07fe3bb5bc0a7e/pynapple/core/time_series.py#L618-L650

Onset windows and maps

baseline_correct(windows, base_start_s, base_stop_s)
    For each window, subtract that window's mean over a stretch before the behavior
    starts. Only "subtract" is offered, because that is the only baseline step found
    in the code.
    linfangu, utils/general/first_beh_in_sessions.m (L47-50)
    https://github.com/linfangu/Computational-neuroscience-toolbox/blob/73fd0598ed8e421f5c2c3b61ea3a5b2c5e568154/utils/general/first_beh_in_sessions.m#L47-L50

apply_occupancy_floor(map, occ, min_s, fill=nan)
    Remove bins the animal barely visited. They become NaN, not 0, so they do not
    pull their neighbours down when the map is smoothed.
    Sun, Doug_spatialInfo.m (L10-11): bins at or below the occupancy threshold
    become NaN
    https://github.com/yanjuns/Sun_Giocomo_2022_NComms/blob/fa2f1b8d20f8130d54bbc9468ccaf287e012a1fe/miniscope_analysis_cpp/Doug_spatialInfo.m#L10-L11
    Yuan_manuscript_2026, Data_analysis_code/get_spatial_selectivity_demo.m (L14):
    bins with fewer than 15 frames are dropped
    https://github.com/HerbertWuLab/Yuan_manuscript_2026/blob/17a5cda79e9832342697e0288efb48ca9bdee840/Data_analysis_code/get_spatial_selectivity_demo.m#L14
    neuro_py, tuning/maps.py (L898-900): sets the rate to 0 instead (not adopted)
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/tuning/maps.py#L898-L900

smooth_map(map, occ, sigma_bins, order="divide_then_smooth")
    Gaussian smoothing of a rate map. order="divide_then_smooth" divides by
    occupancy first and smooths the rate; order="smooth_both" smooths the counts and
    the occupancy and then divides.
    neuro_py, tuning/maps.py (L917-921): smooth the rate map
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/tuning/maps.py#L917-L921
    Representational_Dynamics_demo, src/repdyn/cell_classes.py, smooth_map (L57-63)
    https://github.com/UladzislauBarayeu/Representational_Dynamics_demo/blob/2d267d21066f6e59087427ecedde867c825e414c/src/repdyn/cell_classes.py#L57-L63
"""
