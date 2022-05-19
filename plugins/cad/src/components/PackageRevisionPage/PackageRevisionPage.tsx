/**
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  Breadcrumbs,
  Button,
  ContentHeader,
  Progress,
  Tabs,
} from '@backstage/core-components';
import { useApi, useRouteRef } from '@backstage/core-plugin-api';
import {
  Button as MaterialButton,
  makeStyles,
  Typography,
} from '@material-ui/core';
import Alert, { Color } from '@material-ui/lab/Alert';
import { cloneDeep } from 'lodash';
import React, { Fragment, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useAsync from 'react-use/lib/useAsync';
import { configAsDataApiRef } from '../../apis';
import {
  deployPackageRouteRef,
  editPackageRouteRef,
  packageRouteRef,
} from '../../routes';
import {
  PackageRevision,
  PackageRevisionLifecycle,
} from '../../types/PackageRevision';
import { PackageRevisionResourcesMap } from '../../types/PackageRevisionResource';
import { RepositorySummary } from '../../types/RepositorySummary';
import { RootSync } from '../../types/RootSync';
import {
  findRootSyncForPackage,
  getRootSync,
  getRootSyncSecret,
  getSyncStatus,
  SyncStatus,
  SyncStatusState,
} from '../../utils/configSync';
import {
  canCloneOrDeploy,
  getPackageRevisionTitle,
} from '../../utils/packageRevision';
import { getPackageRevisionResourcesResource } from '../../utils/packageRevisionResources';
import {
  getPackageDescriptor,
  isDeploymentRepository,
} from '../../utils/repository';
import { getRepositorySummary } from '../../utils/repositorySummary';
import { PackageLink, RepositoriesLink, RepositoryLink } from '../Links';
import { AdvancedPackageRevisionOptions } from './components/AdvancedPackageRevisionOptions';
import {
  PackageRevisionResourcesTable,
  ResourcesTableMode,
} from './components/PackageRevisionResourcesTable';

export enum PackageRevisionPageMode {
  EDIT = 'edit',
  VIEW = 'view',
}

type PackageRevisionPageProps = {
  mode: PackageRevisionPageMode;
};

const useStyles = makeStyles({
  packageRevisionOptions: {
    display: 'inherit',
    '& > *': {
      marginTop: 'auto',
      '&:not(:first-child)': {
        marginLeft: '10px',
      },
    },
  },
  syncStatusBanner: {
    padding: '2px 16px',
  },
  syncErrorBanner: {
    whiteSpace: 'break-spaces',
    marginBottom: '16px',
  },
});

export const PackageRevisionPage = ({ mode }: PackageRevisionPageProps) => {
  const { repositoryName, packageName } = useParams();
  const classes = useStyles();
  const navigate = useNavigate();
  const api = useApi(configAsDataApiRef);

  const packageRef = useRouteRef(packageRouteRef);
  const deployPackageRef = useRouteRef(deployPackageRouteRef);
  const editPackageRef = useRouteRef(editPackageRouteRef);

  const [repositorySummary, setRepositorySummary] =
    useState<RepositorySummary>();
  const [packageRevision, setPackageRevision] = useState<PackageRevision>();
  const [resourcesMap, setResourcesMap] = useState<PackageRevisionResourcesMap>(
    {},
  );
  const [rootSync, setRootSync] = useState<RootSync | null>();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>();
  const [userInitiatedApiRequest, setUserInitiatedApiRequest] =
    useState<boolean>(false);

  const loadPackageRevision = async (): Promise<void> => {
    const asyncRepositorySummary = getRepositorySummary(api, repositoryName);
    const asyncPackageRevision = api.getPackageRevision(packageName);
    const asyncResources = api.getPackageRevisionResources(packageName);

    const [repositoryResponse, packageRevisionResponse, resourcesResponse] =
      await Promise.all([
        asyncRepositorySummary,
        asyncPackageRevision,
        asyncResources,
      ]);

    setRepositorySummary(repositoryResponse);
    setPackageRevision(packageRevisionResponse);
    setResourcesMap(resourcesResponse.spec.resources);
  };

  const { loading, error } = useAsync(loadPackageRevision, [
    repositoryName,
    packageName,
    mode,
  ]);

  useAsync(async () => {
    if (packageRevision && repositorySummary) {
      if (
        packageRevision.spec.lifecycle === PackageRevisionLifecycle.PUBLISHED
      ) {
        const { items: allRootSyncs } = await api.listRootSyncs();

        const thisRootSync = findRootSyncForPackage(
          allRootSyncs,
          packageRevision,
          repositorySummary.repository,
        );

        setRootSync(thisRootSync ?? null);
      } else {
        setRootSync(undefined);
      }
    }
  }, [packageRevision, repositorySummary]);

  useEffect(() => {
    if (rootSync) {
      const refreshRootSync = async (): Promise<void> => {
        const latestRootSync = await api.getRootSync(rootSync.metadata.name);
        setRootSync(latestRootSync);
      };

      const refreshSeconds = rootSync.status ? 5 : 1;
      const refreshTimeout = setTimeout(
        () => refreshRootSync(),
        refreshSeconds * 1000,
      );

      return () => {
        clearTimeout(refreshTimeout);
      };
    }

    return undefined;
  }, [api, rootSync]);

  useEffect((): void => {
    if (rootSync && rootSync.status) {
      const thisSyncStatus = getSyncStatus(rootSync.status);
      setSyncStatus(thisSyncStatus);
    } else {
      setSyncStatus(undefined);
    }
  }, [rootSync]);

  if (loading) {
    return <Progress />;
  } else if (error) {
    return <Alert severity="error">{error.message}</Alert>;
  }

  if (!repositorySummary || !packageRevision) {
    return <Alert severity="error">Unexpected undefined value</Alert>;
  }

  const packageRevisionTitle = getPackageRevisionTitle(packageRevision);

  const moveToDraft = async (): Promise<void> => {
    setUserInitiatedApiRequest(true);

    try {
      const targetPackageRevision = cloneDeep(packageRevision);
      targetPackageRevision.spec.lifecycle = PackageRevisionLifecycle.DRAFT;

      const updatedPackageRevision = await api.replacePackageRevision(
        targetPackageRevision,
      );

      setPackageRevision(updatedPackageRevision);
    } finally {
      setUserInitiatedApiRequest(false);
    }
  };

  const moveToProposed = async (): Promise<void> => {
    setUserInitiatedApiRequest(true);

    try {
      const targetPackageRevision = cloneDeep(packageRevision);
      targetPackageRevision.spec.lifecycle = PackageRevisionLifecycle.PROPOSED;

      const updatedPackageRevision = await api.replacePackageRevision(
        targetPackageRevision,
      );

      setPackageRevision(updatedPackageRevision);
    } finally {
      setUserInitiatedApiRequest(false);
    }
  };

  const approvePackage = async (): Promise<void> => {
    setUserInitiatedApiRequest(true);

    try {
      const patchResource = cloneDeep(packageRevision);
      patchResource.spec.lifecycle = PackageRevisionLifecycle.PUBLISHED;

      const approvePackageRevision = await api.approvePackageRevision(
        patchResource,
      );

      setPackageRevision(approvePackageRevision);
    } finally {
      setUserInitiatedApiRequest(false);
    }
  };

  const createSync = async (): Promise<void> => {
    setUserInitiatedApiRequest(true);

    try {
      const repoSecretName =
        repositorySummary.repository.spec.git?.secretRef?.name;

      if (repoSecretName) {
        const baseName = packageRevision.metadata.name.replaceAll(':', '-');
        const newSecretName = `${baseName}-sync`;

        const repoSecret = await api.getSecret(repoSecretName);

        const syncSecret = await getRootSyncSecret(newSecretName, repoSecret);
        const createdSyncSecret = await api.createSecret(syncSecret);

        const rootSyncResource = getRootSync(
          repositorySummary.repository,
          packageRevision,
          createdSyncSecret.metadata.name,
        );

        const newRootSync = await api.createRootSync(rootSyncResource);

        setRootSync(newRootSync);
      }
    } finally {
      setUserInitiatedApiRequest(false);
    }
  };

  const getCurrentSyncStatus = (): JSX.Element => {
    if (syncStatus) {
      const getAlertSeverity = (thisSyncStatus: SyncStatus): Color => {
        switch (thisSyncStatus.state) {
          case SyncStatusState.ERROR:
          case SyncStatusState.STALLED:
            return 'error';
          case SyncStatusState.RECONCILING:
          case SyncStatusState.PENDING:
            return 'info';
          case SyncStatusState.SYNCED:
            return 'success';
          default:
            return 'error';
        }
      };

      const statusSeverity = getAlertSeverity(syncStatus);

      return (
        <Alert
          key="sync-status"
          severity={statusSeverity}
          className={classes.syncStatusBanner}
        >
          {syncStatus.state}
        </Alert>
      );
    }

    if (rootSync) {
      return (
        <Alert
          key="sync-status"
          severity="warning"
          className={classes.syncStatusBanner}
        >
          No Status
        </Alert>
      );
    }

    return <Fragment key="sync-status" />;
  };

  const savePackageRevision = async (): Promise<void> => {
    setUserInitiatedApiRequest(true);

    try {
      const packageRevisionResources = getPackageRevisionResourcesResource(
        packageName,
        resourcesMap,
      );

      await api.replacePackageRevisionResources(packageRevisionResources);

      navigate(packageRef({ repositoryName, packageName }));
    } finally {
      setUserInitiatedApiRequest(false);
    }
  };

  const repository = repositorySummary.repository;
  const packageDescriptor = getPackageDescriptor(repository);

  const renderOptions = (): JSX.Element[] => {
    const options: JSX.Element[] = [];

    if (mode === PackageRevisionPageMode.EDIT) {
      options.push(
        <Button
          key="edit-package"
          to={packageRef({ repositoryName, packageName })}
          variant="outlined"
          disabled={userInitiatedApiRequest}
        >
          Cancel
        </Button>,
      );

      options.push(
        <MaterialButton
          key="save-package"
          onClick={savePackageRevision}
          variant="contained"
          color="primary"
          disabled={userInitiatedApiRequest}
        >
          Save
        </MaterialButton>,
      );
    }

    if (mode === PackageRevisionPageMode.VIEW) {
      const isDraft =
        packageRevision.spec.lifecycle === PackageRevisionLifecycle.DRAFT;
      const isProposed =
        packageRevision.spec.lifecycle === PackageRevisionLifecycle.PROPOSED;
      const isPublished =
        packageRevision.spec.lifecycle === PackageRevisionLifecycle.PUBLISHED;
      const isDeployment = isDeploymentRepository(repositorySummary.repository);

      if (isDraft || isProposed) {
        options.push(
          <div>
            {packageRevision.spec.lifecycle} {packageDescriptor}
          </div>,
        );
      }

      if (isDraft) {
        options.push(
          <Button
            key="edit-package"
            to={editPackageRef({ repositoryName, packageName })}
            color="primary"
            variant="outlined"
            disabled={userInitiatedApiRequest}
          >
            Edit
          </Button>,
        );

        options.push(
          <MaterialButton
            key="propose-package"
            color="primary"
            variant="contained"
            onClick={moveToProposed}
            disabled={userInitiatedApiRequest}
          >
            Propose
          </MaterialButton>,
        );
      }

      if (isProposed) {
        options.push(
          <MaterialButton
            key="draft-package"
            color="primary"
            variant="outlined"
            onClick={moveToDraft}
            disabled={userInitiatedApiRequest}
          >
            Move to Draft
          </MaterialButton>,
        );

        options.push(
          <MaterialButton
            key="approve-package"
            color="primary"
            variant="contained"
            onClick={approvePackage}
            disabled={userInitiatedApiRequest}
          >
            Approve
          </MaterialButton>,
        );
      }

      if (isPublished && isDeployment && rootSync !== undefined) {
        if (rootSync) {
          options.push(getCurrentSyncStatus());
        } else {
          options.push(
            <MaterialButton
              key="create-sync"
              color="primary"
              variant="contained"
              onClick={createSync}
              disabled={userInitiatedApiRequest}
            >
              Create Sync
            </MaterialButton>,
          );
        }
      }

      if (
        repositorySummary.downstreamRepositories.length > 0 &&
        canCloneOrDeploy(packageRevision)
      ) {
        options.push(
          <Button
            key="deploy-package"
            to={deployPackageRef({ repositoryName, packageName })}
            color="primary"
            variant="contained"
            disabled={userInitiatedApiRequest}
          >
            Deploy
          </Button>,
        );
      }
    }

    return options;
  };

  const resourcesTableMode =
    mode === PackageRevisionPageMode.EDIT
      ? ResourcesTableMode.EDIT
      : ResourcesTableMode.VIEW;

  const handleUpdatedResourcesMap = (
    latestResources: PackageRevisionResourcesMap,
  ): void => {
    setResourcesMap(latestResources);
  };

  const isViewMode = mode === PackageRevisionPageMode.VIEW;

  return (
    <div>
      <Breadcrumbs>
        <RepositoriesLink breadcrumb />
        <RepositoryLink repository={repository} breadcrumb />
        {isViewMode && <Typography>{packageRevisionTitle}</Typography>}
        {!isViewMode && (
          <PackageLink
            repository={repository}
            packageRevision={packageRevision}
            breadcrumb
          />
        )}
        {!isViewMode && <Typography>Edit</Typography>}
      </Breadcrumbs>

      <ContentHeader title={packageRevisionTitle}>
        <div className={classes.packageRevisionOptions}>{renderOptions()}</div>
      </ContentHeader>

      <Fragment>
        {syncStatus?.errors?.map((syncError: string) => (
          <Alert severity="error" className={classes.syncErrorBanner}>
            {syncError}
          </Alert>
        ))}
      </Fragment>

      <Tabs
        tabs={[
          {
            label: 'Resources',
            content: (
              <PackageRevisionResourcesTable
                resourcesMap={resourcesMap}
                mode={resourcesTableMode}
                onUpdatedResourcesMap={handleUpdatedResourcesMap}
              />
            ),
          },
          {
            label: 'Advanced',
            content: (
              <AdvancedPackageRevisionOptions
                repository={repository}
                packageName={packageName}
                rootSync={rootSync}
              />
            ),
          },
        ]}
      />
    </div>
  );
};
