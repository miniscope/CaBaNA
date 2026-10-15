"""
cabana.analysis — Shared framework for analyzing neural activity by selecting frames, grouping them by
behavior, position, or other variables, and measuring how neural activity relates to those groups.

Each analysis defines three things:

frames       Which frames to include (yes/no frame labels).
groups       How to group those frames, from a column of session.behavior
             (sniffing vs not for ROC, spatial bin for place cells).
statistic    What to calculate for each cell using its neural data and
             the group labels (e.g., auROC or spatial information).

The shared functions below handle the calculations. Specific analyses, such as
roc_selectivity and spatial_information_test, define the frames, groups, and
statistic to use.

Statistical calculations are in cabana.stats, while frame selection and grouping
functions are in cabana.structuring.

None of these functions have been written yet. Each will be written using the linked code as a reference.

Shared

compute_statistic(session, frames, groups, statistic) -> one number per cell
    Calculates the chosen statistic for each cell using the selected frames
    and the group labels. No shuffling or significance testing.

significance_test(session, frames, groups, statistic, null="circular_shift", n_shifts=1000,
                  min_shift_s=60, shift="full", rng=None) -> observed, null, p per cell
    Calls compute_statistic on the real data, then on neural data shifted against the
    groups many times, and gets a p-value. `null` is a setting, so analyses that do not
    shuffle by circular shift (shuffled labels, none) fit the same function.
    shift="full" rolls the whole recording and then picks the frames; shift="within"
    rolls only the picked frames (the cut points then fall where frames were removed).
    Code_for_2024_ZhangM, ROC.m (L14-30): shift the full recording, then pick frames
    https://github.com/hongw-lab/Code_for_2024_ZhangM/blob/2019a15bf9b802e39040cd361bcc2449f0a206a3/ROC.m#L14-L30
    Code_for_2025_Raam, roc_all.m (L72-74 and L119-128): pick frames, then shift
    https://github.com/hongw-lab/Code_for_2025_Raam/blob/268c7a71c5812c7899cd8e79903931950f524139/roc_all.m#L72-L74
    Sun_Giocomo_2022_NComms, permutingSpike_LR.m (L58-66 and L80-82)
    https://github.com/yanjuns/Sun_Giocomo_2022_NComms/blob/fa2f1b8d20f8130d54bbc9468ccaf287e012a1fe/miniscope_analysis_cpp/permutingSpike_LR.m#L58-L66
    neuro_py, tuning/maps.py (L1090-1119)
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/tuning/maps.py#L1090-L1119
    Yuan_manuscript_2026, get_spatial_selectivity_demo.m (L159-196)
    https://github.com/HerbertWuLab/Yuan_manuscript_2026/blob/17a5cda79e9832342697e0288efb48ca9bdee840/Data_analysis_code/get_spatial_selectivity_demo.m#L159-L196

Analyses built on the shared functions

roc_selectivity(session, column, positive, negative=None, **significance_test_args) -> RocResult
    positive and negative are values of the behavior column (negative=None means every
    other frame). frames: the positive and comparison frames. groups: positive or comparison.
    statistic: AUC. Adds a label per cell (activated / suppressed / neither).
    Code_for_2025_Raam, roc_all.m (L43-76 and L156-170)
    https://github.com/hongw-lab/Code_for_2025_Raam/blob/268c7a71c5812c7899cd8e79903931950f524139/roc_all.m#L43-L76
    Code_for_2024_ZhangM, ROC.m (L14-30)
    https://github.com/hongw-lab/Code_for_2024_ZhangM/blob/2019a15bf9b802e39040cd361bcc2449f0a206a3/ROC.m#L14-L30

roc_summary(result)
    How many cells are activated or suppressed, and how the groups overlap.
    Code_for_2025_Raam, roc_all.m (L166-170)
    https://github.com/hongw-lab/Code_for_2025_Raam/blob/268c7a71c5812c7899cd8e79903931950f524139/roc_all.m#L166-L170

spatial_information_test(session, column, min_speed, **significance_test_args)
    column: a behavior column with one spatial bin per frame (bin_size is set when the
    column is made, in bin_position). frames: running. groups: the spatial bin of each
    frame. statistic: bits per event.
    Sun_Giocomo_2022_NComms, permutingSpike_LR.m (L58-66 and L80-82)
    https://github.com/yanjuns/Sun_Giocomo_2022_NComms/blob/fa2f1b8d20f8130d54bbc9468ccaf287e012a1fe/miniscope_analysis_cpp/permutingSpike_LR.m#L58-L66
    neuro_py, tuning/maps.py (L1090-1119)
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/tuning/maps.py#L1090-L1119
    Yuan_manuscript_2026, get_spatial_selectivity_demo.m (L159-196)
    https://github.com/HerbertWuLab/Yuan_manuscript_2026/blob/17a5cda79e9832342697e0288efb48ca9bdee840/Data_analysis_code/get_spatial_selectivity_demo.m#L159-L196

peth_responsive(session, column, category, pre_s, post_s, **significance_test_args)
    The onsets are the starts of the epochs where behavior[column] is `category`.
    frames: all. groups: windows around the onsets. statistic: mean after minus mean
    before. The before/after difference is from linfangu, first_beh_in_sessions.m
    (L52-53), which uses it to rank cells without a test
    https://github.com/linfangu/Computational-neuroscience-toolbox/blob/73fd0598ed8e421f5c2c3b61ea3a5b2c5e568154/utils/general/first_beh_in_sessions.m#L52-L53

Population analyses (these make a model, not one number per cell, so they sit beside
the shared functions)

fit_pca(matrix, scale=True, n_components=None) -> PcaModel
project(matrix, model)
    Fit PCA and keep its mean and scale, so new data can be projected into the same
    space without refitting.
    optinist, wrappers/optinist/dimension_reduction/pca.py (L40-44)
    https://github.com/oist/optinist/blob/c8f9526300b63bb7bfa7440bbaece3d7505667b0/studio/app/optinist/wrappers/optinist/dimension_reduction/pca.py#L40-L44
    Canton, Figure_5_PCA_dataframe_creation.py (L148-154 and L236-241): fit on baseline
    frames, project trials with the baseline mean and std
    https://github.com/pinto-lab-nu/Canton-JoshEtAl2025/blob/8b8728dc7b4f92cda38235a7dbae9687f3e5af24/Figure_5_PCA_dataframe_creation.py#L148-L154
    linfangu, example_pca_by_trajectory.m (L71): projects with (mean - mu) * coeff
    https://github.com/linfangu/Computational-neuroscience-toolbox/blob/73fd0598ed8e421f5c2c3b61ea3a5b2c5e568154/example_pca_by_trajectory.m#L71

cv_decode(...)   (later)
    Decode the behavior from population neural activity with cross-validation by trial,
    refitting PCA on each training set, plus a label-shuffle control.
    Representational_Dynamics_demo, 4_umap_per_day_CGA.ipynb (cell 2, L271-298)
    https://github.com/UladzislauBarayeu/Representational_Dynamics_demo/blob/2d267d21066f6e59087427ecedde867c825e414c/4_umap_per_day_CGA.ipynb

find_fields(...)   (later)
    Find place fields in a rate map.
    neuro_py, tuning/fields.py, compute_2d_place_fields (L725-); not read yet
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/tuning/fields.py#L725
"""
