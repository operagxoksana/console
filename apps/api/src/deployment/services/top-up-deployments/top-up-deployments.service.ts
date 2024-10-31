import { AllowanceHttpService, BalanceHttpService, DeploymentAllowance } from "@akashnetwork/http-sdk";
import { singleton } from "tsyringe";

import { InjectWallet } from "@src/billing/providers/wallet.provider";
import { MasterWalletService } from "@src/billing/services";
import { LoggerService } from "@src/core";
import { InjectSentry, Sentry } from "@src/core/providers/sentry.provider";
import { SentryEventService } from "@src/core/services/sentry-event/sentry-event.service";
import { DrainingDeploymentOutput, LeaseRepository } from "@src/deployment/repositories/lease/lease.repository";

interface Balances {
  denom: string;
  feesLimit: number;
  deploymentLimit: number;
  balance: number;
  isManaged: boolean;
}

type OwnerType = "CUSTODIAL" | "MANAGED";

@singleton()
export class TopUpDeploymentsService {
  private readonly CONCURRENCY = 10;

  private UNLIMITED_FEES_MANAGED_BALANCE = 1000000;

  private readonly logger = new LoggerService({ context: TopUpDeploymentsService.name });

  constructor(
    private readonly allowanceHttpService: AllowanceHttpService,
    private readonly balanceHttpService: BalanceHttpService,
    @InjectWallet("MANAGED") private readonly managedMasterWalletService: MasterWalletService,
    @InjectWallet("UAKT_TOP_UP") private readonly uaktMasterWalletService: MasterWalletService,
    @InjectWallet("USDC_TOP_UP") private readonly usdtMasterWalletService: MasterWalletService,
    private readonly leaseRepository: LeaseRepository,
    @InjectSentry() private readonly sentry: Sentry,
    private readonly sentryEventService: SentryEventService
  ) {}

  async topUpDeployments() {
    const wallets = [this.uaktMasterWalletService, this.usdtMasterWalletService];

    const topUpAllCustodialDeployments = wallets.map(async wallet => {
      const address = await wallet.getFirstAddress();
      await this.allowanceHttpService.paginateDeploymentGrants({ side: "grantee", address, limit: this.CONCURRENCY }, async grants => {
        await Promise.all(
          grants.map(async grant => {
            await this.execWithErrorHandler(() => this.topUpForGrant("CUSTODIAL", grant));
          })
        );
      });
    });
    await Promise.all(topUpAllCustodialDeployments);

    const address = await this.managedMasterWalletService.getFirstAddress();
    await this.allowanceHttpService.paginateDeploymentGrants({ side: "granter", address, limit: this.CONCURRENCY }, async grants => {
      await Promise.all(
        grants.map(async grant => {
          await this.execWithErrorHandler(() => this.topUpForGrant("MANAGED", grant));
        })
      );
    });
  }

  private async topUpForGrant(ownerType: OwnerType, grant: DeploymentAllowance) {
    const owner = ownerType === "CUSTODIAL" ? grant.granter : grant.grantee;
    const balances = await this.collectWalletBalances(ownerType, grant);
    this.logger.debug({ event: "BALANCES_COLLECTED", granter: owner, grantee: grant.grantee, balances });

    const drainingDeployments = await this.retrieveDrainingDeployments(owner);

    drainingDeployments.map(async deployment => {
      const topUpAmount = await this.calculateTopUpAmount(deployment);
      this.validateTopUpAmount(topUpAmount, balances);
    });
  }

  private async collectWalletBalances(ownerType: OwnerType, grant: DeploymentAllowance): Promise<Balances> {
    const denom = grant.authorization.spend_limit.denom;
    const deploymentLimit = parseFloat(grant.authorization.spend_limit.amount);

    const sides = [grant.granter, grant.grantee];

    const isManaged = ownerType === "MANAGED";

    if (isManaged) {
      sides.reverse();
    }

    const feesLimit = isManaged ? this.UNLIMITED_FEES_MANAGED_BALANCE : await this.retrieveFeesLimit(sides[0], sides[1], denom);

    const { amount } = await this.balanceHttpService.getBalance(sides[0], denom);
    const balance = parseFloat(amount);

    return {
      denom,
      feesLimit,
      deploymentLimit,
      balance,
      isManaged
    };
  }

  private async retrieveFeesLimit(granter: string, grantee: string, denom: string) {
    const feesAllowance = await this.allowanceHttpService.getFeeAllowanceForGranterAndGrantee(granter, grantee);
    const feesSpendLimit = feesAllowance.allowance.spend_limit.find(limit => limit.denom === denom);

    return feesSpendLimit ? parseFloat(feesSpendLimit.amount) : 0;
  }

  private async retrieveDrainingDeployments(owner: string): Promise<DrainingDeploymentOutput[]> {
    this.logger.debug({ event: "RETRIEVING_DRAINING_DEPLOYMENTS", owner, warning: "Not implemented yet" });
    return [];
  }

  private async calculateTopUpAmount(deployment: DrainingDeploymentOutput): Promise<number> {
    this.logger.debug({ event: "CALCULATING_TOP_UP_AMOUNT", deployment, warning: "Not implemented yet" });
    return 0;
  }

  private validateTopUpAmount(amount: number, balances: Balances) {
    this.logger.debug({ event: "VALIDATING_TOP_UP_AMOUNT", amount, balances, warning: "Not implemented yet" });
  }

  private async topUpCustodialDeployment() {
    this.logger.debug({ event: "TOPPING_UP_CUSTODIAL_DEPLOYMENT", warning: "Not implemented yet" });
  }

  private async topUpManagedDeployment() {
    this.logger.debug({ event: "TOPPING_UP_MANAGED_DEPLOYMENT", warning: "Not implemented yet" });
  }

  private async execWithErrorHandler(cb: () => Promise<void>) {
    try {
      await cb();
    } catch (error) {
      const sentryEventId = this.sentry.captureEvent(this.sentryEventService.toEvent(error));
      this.logger.error({ event: "TOP_UP_FAILED", error: error.stack, sentryEventId });
    }
  }
}
