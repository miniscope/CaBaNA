"""
cabana.stats — General calculations shared across multiple analyses. These functions
take arrays as input and return numerical results, without depending on Sessions or behavioral data.

None of these functions have been written yet. Each will be written using the linked code as a reference. 

Shuffle tests

circular_shifts(n_frames, n_shifts, min_shift, rng, within=None)
    Random amounts to roll a trace by. min_shift keeps the roll from being close to
    zero. `within` (yes/no frame labels) restricts the roll to the frames where it is True.
    Code_for_2025_Raam, roc_all.m (L119-128): rolls inside the selected frames, no
    minimum shift by default
    https://github.com/hongw-lab/Code_for_2025_Raam/blob/268c7a71c5812c7899cd8e79903931950f524139/roc_all.m#L119-L128
    Code_for_2024_ZhangM, ROC.m (L21-30): rolls the whole session, shift between 60 s
    and the session length minus 60 s
    https://github.com/hongw-lab/Code_for_2024_ZhangM/blob/2019a15bf9b802e39040cd361bcc2449f0a206a3/ROC.m#L21-L30
    Sun_Giocomo_2022_NComms, permutingSpike_LR.m (L24): shift between 5% and 95% of
    the session
    https://github.com/yanjuns/Sun_Giocomo_2022_NComms/blob/fa2f1b8d20f8130d54bbc9468ccaf287e012a1fe/miniscope_analysis_cpp/permutingSpike_LR.m#L24
    Yuan_manuscript_2026, get_spatial_selectivity_demo.m (L159): shift of 300 frames
    or more
    https://github.com/HerbertWuLab/Yuan_manuscript_2026/blob/17a5cda79e9832342697e0288efb48ca9bdee840/Data_analysis_code/get_spatial_selectivity_demo.m#L159
    neuro_py, tuning/maps.py (L1090-1119): shifts the position, no minimum
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/tuning/maps.py#L1090-L1119
    Representational_Dynamics_demo, src/repdyn/cell_classes.py (L80-85)
    https://github.com/UladzislauBarayeu/Representational_Dynamics_demo/blob/2d267d21066f6e59087427ecedde867c825e414c/src/repdyn/cell_classes.py#L80-L85

empirical_pvalue(obs, null, tail="two-sided", add_one=True)
    The fraction of shuffled values at least as extreme as the real one. add_one=True
    counts the real value too, so p is never exactly 0.
    neuro_py, stats/stats.py (L50-57): (r + 1) / (n + 1)
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/stats/stats.py#L50-L57
    Code_for_2025_Raam, roc_all.m (L156-165): two-sided, 2 x the smaller tail
    https://github.com/hongw-lab/Code_for_2025_Raam/blob/268c7a71c5812c7899cd8e79903931950f524139/roc_all.m#L156-L165
    Yuan_manuscript_2026, get_spatial_selectivity_demo.m (L196): mean(null >= obs)
    https://github.com/HerbertWuLab/Yuan_manuscript_2026/blob/17a5cda79e9832342697e0288efb48ca9bdee840/Data_analysis_code/get_spatial_selectivity_demo.m#L196

correct_pvalues(p, method="holm")
    Adjust p-values for testing many cells at once, skipping NaN.
    Representational_Dynamics_demo, src/repdyn/stats.py, holm (L86-93)
    https://github.com/UladzislauBarayeu/Representational_Dynamics_demo/blob/2d267d21066f6e59087427ecedde867c825e414c/src/repdyn/stats.py#L86-L93

Comparing two groups of frames

auc_rank(pos, neg)
    Area under the ROC curve for each cell, computed from ranks (Mann-Whitney, ties
    count half). Gives the same number as the ROC curve.
    Code_for_2025_Raam, roc_all.m (L103 and L136): AUC from perfcurve
    https://github.com/hongw-lab/Code_for_2025_Raam/blob/268c7a71c5812c7899cd8e79903931950f524139/roc_all.m#L103
    Code_for_2024_ZhangM, ROC.m (L27)
    https://github.com/hongw-lab/Code_for_2024_ZhangM/blob/2019a15bf9b802e39040cd361bcc2449f0a206a3/ROC.m#L27
    Dopamine-constraints, Code/roc_prepareData.m (L78-106): builds the curve by
    sweeping a threshold and integrates it (not adopted: it can stop short of the
    corner and read low)
    https://github.com/sotmasman/Dopamine-constraints/blob/fbb765c56a291f100e11716941db40561c2cded4/Code/roc_prepareData.m#L78-L106

Time and neural activity per label (a spatial bin is a label too)

time_in_label(frame_labels, fps)
    Seconds spent in each label value (each spatial bin, each behavior).
    neuro_py, tuning/maps.py (L940-943): counts per bin divided by the sampling rate
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/tuning/maps.py#L940-L943
    Sun_Giocomo_2022_NComms, calculate_firing_ratemap.m (L31-32): count x frame length
    https://github.com/yanjuns/Sun_Giocomo_2022_NComms/blob/fa2f1b8d20f8130d54bbc9468ccaf287e012a1fe/miniscope_analysis_cpp/calculate_firing_ratemap.m#L31-L32
    pynapple, process/tuning_curves.py (L281): occupancy in samples, converted with fs
    https://github.com/pynapple-org/pynapple/blob/7fdadfbc105bf5f380cd8a1eaf07fe3bb5bc0a7e/pynapple/process/tuning_curves.py#L281

mean_by_label(neural, frame_labels, kind="mean")
    Neural activity per label value. kind="mean" is the average trace value on that
    label's frames; kind="rate" is the number of deconvolved events
    divided by the time on that label. They are
    different units.
    Yuan_manuscript_2026, get_spatial_selectivity_demo.m (L109-136): mean neural activity per
    bin, bins with fewer than min_frames skipped
    https://github.com/HerbertWuLab/Yuan_manuscript_2026/blob/17a5cda79e9832342697e0288efb48ca9bdee840/Data_analysis_code/get_spatial_selectivity_demo.m#L109-L136
    Sun_Giocomo_2022_NComms, calculate_firing_ratemap.m (L34-50): event counts divided
    by time per bin
    https://github.com/yanjuns/Sun_Giocomo_2022_NComms/blob/fa2f1b8d20f8130d54bbc9468ccaf287e012a1fe/miniscope_analysis_cpp/calculate_firing_ratemap.m#L34-L50

Place maps

skaggs_information(map, occ, rbar="map")
    Spatial information in bits per event and bits per second. rbar="map" uses the
    occupancy-weighted mean of the map; rbar="total" uses total neural activity divided by
    total time.
    Sun_Giocomo_2022_NComms, Doug_spatialInfo.m (L10-28)
    https://github.com/yanjuns/Sun_Giocomo_2022_NComms/blob/fa2f1b8d20f8130d54bbc9468ccaf287e012a1fe/miniscope_analysis_cpp/Doug_spatialInfo.m#L10-L28
    nelpy, utils.py (L193-226)
    https://github.com/nelpy/nelpy/blob/29c0f0ac49cf47bce405654e29594fc364cf9f8a/nelpy/utils.py#L193-L226
    pynapple, process/tuning_curves.py (L568-589)
    https://github.com/pynapple-org/pynapple/blob/7fdadfbc105bf5f380cd8a1eaf07fe3bb5bc0a7e/pynapple/process/tuning_curves.py#L568-L589

spatial_sparsity(map, occ)
    How concentrated the map is, weighted by occupancy.
    nelpy, utils.py (L360-363)
    https://github.com/nelpy/nelpy/blob/29c0f0ac49cf47bce405654e29594fc364cf9f8a/nelpy/utils.py#L360-L363

split_half_stability(...)
    Correlate the map from one half of the session with the map from the other half.
    Yuan_manuscript_2026, get_spatial_selectivity_demo.m (L89-146): first half vs second
    half, Spearman
    https://github.com/HerbertWuLab/Yuan_manuscript_2026/blob/17a5cda79e9832342697e0288efb48ca9bdee840/Data_analysis_code/get_spatial_selectivity_demo.m#L89-L146
    Representational_Dynamics_demo, src/repdyn/cell_classes.py, pooled_reliability
    (L93-109): odd vs even trials
    https://github.com/UladzislauBarayeu/Representational_Dynamics_demo/blob/2d267d21066f6e59087427ecedde867c825e414c/src/repdyn/cell_classes.py#L93-L109

Onset-aligned averages

summary_band(windows, stat="mean", ci="sem")
    Mean over windows with a band: "sem", "percentile" or "bootstrap".
    optinist, basic_neural_analysis/eta.py (L134-136): mean, std and std / sqrt(n)
    (population std; use the sample std)
    https://github.com/oist/optinist/blob/c8f9526300b63bb7bfa7440bbaece3d7505667b0/studio/app/optinist/wrappers/optinist/basic_neural_analysis/eta.py#L134-L136
    AbbyCui, Peri-Stimulus.py (L145-148): 2.5th and 97.5th percentiles across all
    traces (a spread of responses, not a confidence interval)
    https://github.com/AbbyCui/CalciumImagingAnalysis/blob/c4057b68b2cdc12f08bb332f480852d5a2d5987c/Peri-Stimulus.py#L145-L148
    dCA1_Paper, onep/trace_analysis_functions.py (L24-45 and L249-255): bootstrap
    confidence interval at each time point
    https://github.com/rsenne/dCA1_Paper/blob/280eae5a9e78542907d8c1c7fcb55209ac5a40e8/onep/trace_analysis_functions.py#L24-L45

Population vectors

pv_distance(scores, groups, n_pcs)
    Distance between groups of points in the first n_pcs principal components.
    Slice the components (scores[:, :n_pcs]), not the rows.
    Canton, Canton_Josh_et_al_2025_PCA_functions.py (L92-101 and L183-186)
    https://github.com/pinto-lab-nu/Canton-JoshEtAl2025/blob/8b8728dc7b4f92cda38235a7dbae9687f3e5af24/Canton_Josh_et_al_2025_PCA_functions.py#L92-L101
    linfangu, example_pca_by_bout.m (L54-60): mean pairwise distance between behaviors
    https://github.com/linfangu/Computational-neuroscience-toolbox/blob/73fd0598ed8e421f5c2c3b61ea3a5b2c5e568154/example_pca_by_bout.m#L54-L60

pv_correlation(vec_a, vec_b)
    Correlation between two population vectors (one value per cell), skipping cells
    that are NaN in either.
    tadblair, Blair_et_al_MATLAB/pv_heatmap_cormatrix.m (L5-14)
    https://github.com/tadblair/tadblair/blob/97dc8a29fb9c3ede5507e63daf2b0b2bf279e316/Blair_et_al_MATLAB/pv_heatmap_cormatrix.m#L5-L14
"""
